import { type BuiltInRoleName, builtInRoles } from "@margaya/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { projectReach } from "../project/visibility";
import { isInstanceAdmin } from "./is-instance-admin";

type PermissionMap = Record<string, string[]>;

export function builtInRoleStatements(
  role: string,
): Record<string, readonly string[]> | null {
  if (role in builtInRoles) {
    return builtInRoles[role as BuiltInRoleName].statements as Record<
      string,
      readonly string[]
    >;
  }
  return null;
}

function parsePermissionStatements(
  raw: string,
): Record<string, readonly string[]> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  // Only keep entries shaped like { [resource: string]: string[] }.
  // Anything malformed is dropped so `satisfies()` never calls
  // `.includes()` on a non-array.
  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) continue;
    const filtered = actions.filter(
      (action): action is string => typeof action === "string",
    );
    if (filtered.length > 0) {
      result[resource] = filtered;
    }
  }
  return result;
}

export async function customRoleStatements(
  workspaceId: string,
  role: string,
): Promise<Record<string, readonly string[]> | null> {
  const [row] = await db
    .select({ permission: schema.workspaceRoleTable.permission })
    .from(schema.workspaceRoleTable)
    .where(
      and(
        eq(schema.workspaceRoleTable.workspaceId, workspaceId),
        eq(schema.workspaceRoleTable.role, role),
      ),
    )
    .limit(1);

  if (!row?.permission) return null;

  return parsePermissionStatements(row.permission);
}

function satisfies(
  statements: Record<string, readonly string[]>,
  required: PermissionMap,
): boolean {
  for (const [resource, actions] of Object.entries(required)) {
    const granted = statements[resource];
    if (!granted) return false;
    for (const action of actions) {
      if (!granted.includes(action)) return false;
    }
  }
  return true;
}

export async function hasWorkspacePermission(
  c: Context,
  permissions: PermissionMap,
) {
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) return false;

  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
    return false;
  }

  if (await isInstanceAdmin(c)) {
    return true;
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const [member] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);

  if (!member?.role) return false;

  // Prefer the DB row when present so admin-edited defaults
  // (viewer/member/admin) take effect immediately. Falls back to the
  // compiled-in static definitions only when no row exists, which protects
  // viewer/member/admin users from a 403 if their workspace somehow
  // missed the seed (e.g., seed failed during workspace creation and
  // the boot-time backfill hasn't run yet).
  const statements =
    (await customRoleStatements(workspaceId, member.role)) ??
    builtInRoleStatements(member.role);

  if (!statements || !satisfies(statements, permissions)) return false;
  const ceilings = await projectRoleCeilings(c, workspaceId);
  return ceilings.every((ceiling) => satisfies(ceiling, permissions));
}

/**
 * In a restricted project, a project member's rights are what both their
 * workspace role and their project role grant: one statement set per
 * project the request acts on. Empty for open projects and for workspace
 * owners and admins (project/visibility.ts).
 */
async function projectRoleCeilings(
  c: Context,
  workspaceId: string,
): Promise<Record<string, readonly string[]>[]> {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return [];
  const many = c.get("projectIds") as string[] | undefined;
  const one = c.get("projectId") as string | null | undefined;
  const projectIds = many?.length ? many : one ? [one] : [];
  const ceilings: Record<string, readonly string[]>[] = [];
  for (const projectId of projectIds) {
    const reach = await projectReach(userId, projectId);
    if (!reach?.projectRole) continue;
    ceilings.push(
      (await customRoleStatements(workspaceId, reach.projectRole)) ??
        builtInRoleStatements(reach.projectRole) ??
        {},
    );
  }
  return ceilings;
}

/**
 * Loads the caller's statements for the context's workspace once and
 * answers any number of permission questions with the same rules as
 * `hasWorkspacePermission`. For reads that report many capabilities.
 */
export async function workspacePermissionChecker(
  c: Context,
): Promise<(permissions: PermissionMap) => boolean> {
  const workspaceId = c.get("workspaceId");
  if (!workspaceId) return () => false;

  const apiKey = c.get("apiKey") as
    | { permissions?: Record<string, string[]> | null }
    | undefined;
  const withinKeyScope = (permissions: PermissionMap) =>
    !apiKey?.permissions || satisfies(apiKey.permissions, permissions);

  if (await isInstanceAdmin(c)) return withinKeyScope;

  const userId = c.get("userId");
  const [member] = userId
    ? await db
        .select({ role: schema.workspaceUserTable.role })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspaceId),
            eq(schema.workspaceUserTable.userId, userId),
          ),
        )
        .limit(1)
    : [];
  const statements = member?.role
    ? ((await customRoleStatements(workspaceId, member.role)) ??
      builtInRoleStatements(member.role))
    : null;
  const ceilings = statements ? await projectRoleCeilings(c, workspaceId) : [];

  return (permissions) =>
    withinKeyScope(permissions) &&
    Boolean(statements && satisfies(statements, permissions)) &&
    ceilings.every((ceiling) => satisfies(ceiling, permissions));
}

export function requireWorkspacePermission(permissions: PermissionMap) {
  return async (c: Context, next: Next) => {
    if (!c.get("workspaceId")) {
      throw new HTTPException(500, {
        message: "workspaceId not set in context",
      });
    }

    const apiKey = c.get("apiKey") as
      | { permissions?: Record<string, string[]> | null }
      | undefined;
    if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
      throw new HTTPException(403, { message: "Insufficient API key scope" });
    }

    if (!(await hasWorkspacePermission(c, permissions))) {
      if (!c.get("userId")) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    return next();
  };
}
