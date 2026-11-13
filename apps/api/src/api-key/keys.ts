import { APIError } from "better-auth/api";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { recordAudit } from "../audit-log/record";
import { workspacesOf } from "../audit-log/snapshots";
import { auth } from "../auth";
import db from "../database";
import {
  apikeyTable,
  projectTable,
  workspaceUserTable,
} from "../database/schema";
import { hiddenProjectIdsAnywhere } from "../project/visibility";
import {
  type ApiKeyAccess,
  type ApiKeyArea,
  type AreaLevel,
  areasOf,
  decodeScope,
  encodeScope,
} from "./scope";

type ScopeView = {
  access: ApiKeyAccess;
  areas: Partial<Record<ApiKeyArea, AreaLevel>>;
  projects: { id: string; name: string | null }[] | null;
};

function parseStored(raw: string | null): Record<string, string[]> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

async function projectNames(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(and(inArray(projectTable.id, ids), isNull(projectTable.deletedAt)));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function scopeViews(rawPermissions: (string | null)[]) {
  const decoded = rawPermissions.map((raw) => decodeScope(parseStored(raw)));
  const names = await projectNames([
    ...new Set(decoded.flatMap((scope) => scope.projectIds ?? [])),
  ]);
  return decoded.map(
    (scope): ScopeView => ({
      access: scope.access,
      areas: areasOf(scope.permissions),
      projects: scope.projectIds
        ? scope.projectIds.map((id) => ({ id, name: names.get(id) ?? null }))
        : null,
    }),
  );
}

const ownedBy = (userId: string) =>
  or(eq(apikeyTable.referenceId, userId), eq(apikeyTable.userId, userId));

/** The caller's keys with their scopes, newest first. Never the key itself. */
export async function listApiKeys(userId: string) {
  const rows = await db
    .select({
      id: apikeyTable.id,
      name: apikeyTable.name,
      start: apikeyTable.start,
      enabled: apikeyTable.enabled,
      createdAt: apikeyTable.createdAt,
      expiresAt: apikeyTable.expiresAt,
      lastRequest: apikeyTable.lastRequest,
      permissions: apikeyTable.permissions,
    })
    .from(apikeyTable)
    .where(
      and(
        ownedBy(userId),
        // A Slack action's key lives for one action (slack-app/acting-user.ts).
        or(isNull(apikeyTable.prefix), ne(apikeyTable.prefix, "mgslack_")),
      ),
    )
    .orderBy(desc(apikeyTable.createdAt), desc(apikeyTable.id));
  const scopes = await scopeViews(rows.map((row) => row.permissions));
  return rows.map(({ permissions: _permissions, ...row }, index) => ({
    ...row,
    enabled: row.enabled ?? false,
    scope: scopes[index] as ScopeView,
  }));
}

/** 404 unless the key belongs to the caller. */
export async function assertOwnApiKey(userId: string, keyId: string) {
  const [row] = await db
    .select({ id: apikeyTable.id })
    .from(apikeyTable)
    .where(and(eq(apikeyTable.id, keyId), ownedBy(userId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "API key not found" });
}

/** Projects must exist, be live, and sit in a workspace the caller is in. */
async function assertReachableProjects(userId: string, projectIds: string[]) {
  if (projectIds.length === 0) return;
  const rows = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .where(
      and(inArray(projectTable.id, projectIds), isNull(projectTable.deletedAt)),
    );
  const found = new Set(rows.map((row) => row.id));
  // A restricted project the caller cannot see reads as missing. Keys act as
  // their owner, so a key never reaches past its owner's projects anyway.
  const hidden = await hiddenProjectIdsAnywhere(userId, projectIds);
  if (projectIds.some((id) => !found.has(id) || hidden.has(id))) {
    throw new HTTPException(400, {
      message: "projectIds: a project was not found",
    });
  }
}

type CreateInput = {
  name: string;
  expiresIn: number | null;
  access: ApiKeyAccess;
  areas?: Partial<Record<ApiKeyArea, AreaLevel>>;
  projectIds?: string[];
};

/**
 * Creates a key through Better Auth on the server, the only place that may
 * set its permissions, so the scope can't be changed from a browser later.
 */
export async function createScopedApiKey(userId: string, input: CreateInput) {
  const projectIds = [...new Set(input.projectIds ?? [])];
  await assertReachableProjects(userId, projectIds);
  const permissions = encodeScope({
    access: input.access,
    areas: input.areas,
    projectIds,
  });

  let created: { id: string; key: string };
  try {
    created = (await auth.api.createApiKey({
      body: {
        name: input.name,
        expiresIn: input.expiresIn,
        userId,
        ...(permissions ? { permissions } : {}),
      },
    })) as { id: string; key: string };
  } catch (error) {
    if (error instanceof APIError) {
      throw new HTTPException(400, {
        message: error.message || "Couldn't create the API key",
      });
    }
    throw error;
  }

  const workspaceIds = await workspacesOf(userId);
  await recordAudit(
    workspaceIds.map((workspaceId) => ({
      workspaceId,
      action: "api_key.created" as const,
      target: { type: "api_key", id: created.id, label: input.name },
      metadata: {
        scoped: permissions !== null,
        access: input.access,
        projectCount: projectIds.length,
      },
    })),
  );

  const [summary] = (await listApiKeys(userId)).filter(
    (key) => key.id === created.id,
  );
  if (!summary) throw new HTTPException(500, { message: "Key not found" });
  return { ...summary, key: created.key };
}
