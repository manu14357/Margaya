import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  apikeyTable,
  integrationTable,
  invitationProjectTable,
  invitationTable,
  projectTable,
  userTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
  workspaceWebhookTable,
} from "../database/schema";
import { isSensitiveKey, redact, redactUrl } from "./redact";

// Point-in-time reads of the things an audited request changes, taken before
// and after it so entries can carry a before/after diff and a label that
// survives a delete. Every value here goes through `redact` again on write.

export async function userLabel(userId: string | null | undefined) {
  if (!userId) return null;
  const [user] = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user ? user.name || user.email : null;
}

/**
 * A pending invitation's workspace, email and projects (`projectId:role`,
 * sorted), around a change to the projects it adds.
 */
export async function invitationProjectsSnapshot(
  invitationId: string | undefined,
) {
  if (!invitationId) return null;
  const [invitation] = await db
    .select({
      workspaceId: invitationTable.workspaceId,
      email: invitationTable.email,
    })
    .from(invitationTable)
    .where(eq(invitationTable.id, invitationId))
    .limit(1);
  if (!invitation) return null;
  const rows = await db
    .select({
      projectId: invitationProjectTable.projectId,
      role: invitationProjectTable.role,
    })
    .from(invitationProjectTable)
    .where(eq(invitationProjectTable.invitationId, invitationId));
  return {
    ...invitation,
    projects: rows.map((row) => `${row.projectId}:${row.role}`).sort(),
  };
}

/** The role a pending invitation grants, before a change to it. */
export async function invitationRole(invitationId: string | undefined) {
  if (!invitationId) return null;
  const [row] = await db
    .select({ role: invitationTable.role })
    .from(invitationTable)
    .where(eq(invitationTable.id, invitationId))
    .limit(1);
  return row ? (row.role ?? null) : null;
}

export async function projectLabel(projectId: string | null | undefined) {
  if (!projectId) return null;
  const [row] = await db
    .select({ name: projectTable.name, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row ?? null;
}

/** A workspace member by member id or email, with a readable label. */
export async function memberSnapshot(
  memberIdOrEmail: string,
  workspaceId: string | null,
) {
  const byEmail = memberIdOrEmail.includes("@");
  const [row] = await db
    .select({
      id: workspaceUserTable.id,
      userId: workspaceUserTable.userId,
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
      name: userTable.name,
      email: userTable.email,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        byEmail
          ? eq(userTable.email, memberIdOrEmail.toLowerCase())
          : eq(workspaceUserTable.id, memberIdOrEmail),
        workspaceId
          ? eq(workspaceUserTable.workspaceId, workspaceId)
          : undefined,
      ),
    )
    .limit(1);
  return row ? { ...row, label: row.name || row.email } : null;
}

// Columns that are bookkeeping, not settings.
const WORKSPACE_IGNORED = new Set(["id", "createdAt", "updatedAt"]);

/** The workspace's settings columns (whatever the schema has today). */
export async function workspaceSnapshot(workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!WORKSPACE_IGNORED.has(key)) out[key] = value;
  }
  return out;
}

function parsePermission(raw: string | null) {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

export async function roleSnapshot(
  workspaceId: string,
  ref: { roleId?: unknown; roleName?: unknown },
) {
  const roleId = typeof ref.roleId === "string" ? ref.roleId : null;
  const roleName = typeof ref.roleName === "string" ? ref.roleName : null;
  if (!roleId && !roleName) return null;
  const [row] = await db
    .select()
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        roleId
          ? eq(workspaceRoleTable.id, roleId)
          : eq(workspaceRoleTable.role, roleName as string),
      ),
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        role: row.role,
        permission: parsePermission(row.permission),
      }
    : null;
}

/** "resource:action" grants added and removed between two permission maps. */
export function permissionChanges(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
) {
  const flat = (map: Record<string, string[]>) =>
    new Set(
      Object.entries(map).flatMap(([resource, actions]) =>
        (Array.isArray(actions) ? actions : []).map(
          (action) => `${resource}:${action}`,
        ),
      ),
    );
  const was = flat(before);
  const now = flat(after);
  return {
    added: [...now].filter((grant) => !was.has(grant)).sort(),
    removed: [...was].filter((grant) => !now.has(grant)).sort(),
  };
}

export async function apiKeySnapshot(keyId: string) {
  const [row] = await db
    .select({
      id: apikeyTable.id,
      name: apikeyTable.name,
      referenceId: apikeyTable.referenceId,
      userId: apikeyTable.userId,
    })
    .from(apikeyTable)
    .where(eq(apikeyTable.id, keyId))
    .limit(1);
  return row
    ? { id: row.id, name: row.name, ownerId: row.referenceId ?? row.userId }
    : null;
}

/** Every workspace a user belongs to: where their API keys reach. */
export async function workspacesOf(userId: string | null | undefined) {
  if (!userId) return [];
  const rows = await db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
  return rows.map((row) => row.workspaceId);
}

export async function webhookSnapshot(webhookId: string) {
  const [row] = await db
    .select({
      id: workspaceWebhookTable.id,
      workspaceId: workspaceWebhookTable.workspaceId,
      name: workspaceWebhookTable.name,
      url: workspaceWebhookTable.url,
      events: workspaceWebhookTable.events,
      isActive: workspaceWebhookTable.isActive,
    })
    .from(workspaceWebhookTable)
    .where(eq(workspaceWebhookTable.id, webhookId))
    .limit(1);
  if (!row) return null;
  // The path or query of an endpoint can carry a token; keep the host.
  const url = redactUrl(row.url);
  return {
    workspaceId: row.workspaceId,
    label: row.name || url,
    fields: { name: row.name, url, events: row.events, isActive: row.isActive },
  };
}

function integrationConfig(raw: string) {
  let config: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      config = value as Record<string, unknown>;
    }
  } catch {
    // An unreadable config contributes nothing to the diff.
  }
  const out: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSensitiveKey(key)) {
      // A fingerprint, so a changed secret shows up in the diff (which only
      // ever says "[redacted]" for it); never written anywhere.
      secrets[key] = value
        ? createHash("sha256").update(JSON.stringify(value)).digest("hex")
        : value;
    } else {
      out[key] =
        typeof value === "string" && /url$/i.test(key) && value
          ? redactUrl(value)
          : value;
    }
  }
  return { ...(redact(out) as Record<string, unknown>), ...secrets };
}

export async function integrationSnapshot(projectId: string, type: string) {
  const [row] = await db
    .select()
    .from(integrationTable)
    .where(
      and(
        eq(integrationTable.projectId, projectId),
        eq(integrationTable.type, type),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    fields: { isActive: row.isActive, ...integrationConfig(row.config) },
  };
}
