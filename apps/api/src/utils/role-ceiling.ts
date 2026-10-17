import {
  grantsWithin,
  mergeStatements,
  type PermissionStatements,
} from "@margaya/permissions";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import {
  builtInRoleStatements,
  customRoleStatements,
} from "./require-workspace-permission";

export type RoleCeilingError = { status: 400 | 403; message: string };

/** Role names from Better Auth's `role` input: "a", "a,b" or ["a", "b"]. */
export function splitRoles(role: unknown): string[] {
  const parts = Array.isArray(role) ? role : [role];
  return parts
    .flatMap((part) => (typeof part === "string" ? part.split(",") : []))
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * A role's statements: the workspace's `workspace_role` row first (so edited
 * defaults count), then the compiled-in role. Null for an unknown name.
 */
export async function roleStatements(
  workspaceId: string,
  role: string,
): Promise<PermissionStatements | null> {
  return (
    (await customRoleStatements(workspaceId, role)) ??
    builtInRoleStatements(role)
  );
}

/** The merged statements of the roles, or the first unknown name. */
async function statementsOf(
  workspaceId: string,
  roles: string[],
): Promise<{ statements: PermissionStatements } | { unknown: string }> {
  const sets: PermissionStatements[] = [];
  for (const role of roles) {
    const statements = await roleStatements(workspaceId, role);
    if (!statements) return { unknown: role };
    sets.push(statements);
  }
  return { statements: mergeStatements(...sets) };
}

/**
 * Why `userId` may not grant `roles` in the workspace, or null when they may.
 *
 * The ceiling (see `grantsWithin`): a role is above yours when it grants any
 * permission statement your own role does not. Owners and instance admins
 * have no ceiling. A caller who is not a member gets null: the endpoint's own
 * membership and permission checks answer them.
 */
export async function roleCeilingError({
  workspaceId,
  userId,
  roles,
  instanceAdmin,
}: {
  workspaceId: string;
  userId: string;
  roles: string[];
  instanceAdmin: boolean;
}): Promise<RoleCeilingError | null> {
  let callerRoles: string[] = [];
  if (!instanceAdmin) {
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
    if (!member) return null;
    callerRoles = splitRoles(member.role);
  }

  if (roles.length === 0) {
    return { status: 400, message: "A role is required" };
  }
  const requested = await statementsOf(workspaceId, roles);
  if ("unknown" in requested) {
    return { status: 400, message: `Role not found: ${requested.unknown}` };
  }

  if (instanceAdmin || callerRoles.includes("owner")) return null;

  const own = await statementsOf(workspaceId, callerRoles);
  if ("unknown" in own || !grantsWithin(requested.statements, own.statements)) {
    return {
      status: 403,
      message: "You can't grant a role with permissions beyond your own",
    };
  }
  return null;
}

/**
 * Why `userId` may not change the member `memberId` to `roles`, or null when
 * they may. The same ceiling as for invitations, plus: the member's current
 * role must not be above the caller's either (no demoting someone above
 * you), and nobody raises their own role. Owners and instance admins have
 * no ceiling; Better Auth itself still protects the owner role.
 */
export async function memberRoleChangeError({
  memberId,
  userId,
  roles,
  instanceAdmin,
}: {
  memberId: string;
  userId: string;
  roles: string[];
  instanceAdmin: boolean;
}): Promise<RoleCeilingError | null> {
  const [target] = await db
    .select({
      workspaceId: schema.workspaceUserTable.workspaceId,
      userId: schema.workspaceUserTable.userId,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.id, memberId))
    .limit(1);
  // An unknown member: Better Auth answers it.
  if (!target) return null;

  const ceiling = await roleCeilingError({
    workspaceId: target.workspaceId,
    userId,
    roles,
    instanceAdmin,
  });
  if (ceiling) {
    return ceiling.status === 403 && target.userId === userId
      ? { status: 403, message: "You can't raise your own role" }
      : ceiling;
  }
  if (instanceAdmin) return null;

  const [caller] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, target.workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!caller) return null;
  const callerRoles = splitRoles(caller.role);
  if (callerRoles.includes("owner")) return null;

  const own = await statementsOf(target.workspaceId, callerRoles);
  const current = await statementsOf(
    target.workspaceId,
    splitRoles(target.role),
  );
  if (
    "unknown" in own ||
    "unknown" in current ||
    !grantsWithin(current.statements, own.statements)
  ) {
    return {
      status: 403,
      message: "You can't change the role of a member above you",
    };
  }
  return null;
}
