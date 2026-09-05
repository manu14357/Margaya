import {
  DEFAULT_ROLE_NAMES,
  type DefaultRoleName,
  defaultRolePayloads,
} from "@margaya/permissions";
import { eq, inArray, sql } from "drizzle-orm";
import db, { schema } from "../database";

// Resources every seeded default role row already had when this backfill was
// introduced. They are never backfilled, so an admin who removed one of them
// from a role keeps that decision.
export const BASELINE_ROLE_RESOURCES: readonly string[] = [
  "organization",
  "member",
  "invitation",
  "team",
  "ac",
  "project",
  "task",
  "label",
  "workspace",
];

type Payload = Record<string, string[]>;
type RolePayloads = Record<DefaultRoleName, Payload>;

/**
 * Resources the built-in default roles grant that are neither baseline nor
 * already backfilled: the ones existing role rows may be missing.
 */
export function pendingBackfillResources(
  applied: ReadonlySet<string>,
  payloads: RolePayloads = defaultRolePayloads,
): string[] {
  const resources = new Set<string>();
  for (const payload of Object.values(payloads)) {
    for (const resource of Object.keys(payload)) resources.add(resource);
  }
  return [...resources]
    .filter(
      (resource) =>
        !BASELINE_ROLE_RESOURCES.includes(resource) && !applied.has(resource),
    )
    .sort();
}

/**
 * Adds each of `resources` the stored permissions lack, with the default
 * role's actions. Existing entries are never changed. Returns null when
 * nothing needs to change.
 */
export function addMissingResources(
  stored: Payload,
  defaults: Payload,
  resources: readonly string[],
): Payload | null {
  let next: Payload | null = null;
  for (const resource of resources) {
    const actions = defaults[resource];
    if (!actions?.length || Object.hasOwn(stored, resource)) continue;
    next ??= { ...stored };
    next[resource] = [...actions];
  }
  return next;
}

function parseStoredPermission(raw: string): Payload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Payload;
  } catch {
    return null;
  }
}

function isDefaultRoleName(role: string): role is DefaultRoleName {
  return (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
}

/**
 * Gives existing workspaces the permission resources added after their
 * default roles (viewer, member, admin) were seeded, so a new feature doesn't
 * answer 403 there. Generic: any resource the built-in roles grant that is
 * not baseline is added once, with the role's default actions, to the rows
 * that lack it, then recorded in `role_permission_backfill`. Recorded
 * resources are never touched again, so later admin edits stick. Custom
 * roles are left alone. Idempotent and safe to run from several instances.
 */
export async function backfillRolePermissions(
  payloads: RolePayloads = defaultRolePayloads,
) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('role_permission_backfill'))`,
    );

    const applied = await tx
      .select({ resource: schema.rolePermissionBackfillTable.resource })
      .from(schema.rolePermissionBackfillTable);
    const pending = pendingBackfillResources(
      new Set(applied.map((row) => row.resource)),
      payloads,
    );
    if (pending.length === 0) return null;

    const rows = await tx
      .select({
        id: schema.workspaceRoleTable.id,
        role: schema.workspaceRoleTable.role,
        permission: schema.workspaceRoleTable.permission,
      })
      .from(schema.workspaceRoleTable)
      .where(inArray(schema.workspaceRoleTable.role, [...DEFAULT_ROLE_NAMES]));

    let updated = 0;
    for (const row of rows) {
      if (!isDefaultRoleName(row.role)) continue;
      const stored = parseStoredPermission(row.permission);
      if (!stored) continue;
      const next = addMissingResources(stored, payloads[row.role], pending);
      if (!next) continue;
      await tx
        .update(schema.workspaceRoleTable)
        .set({ permission: JSON.stringify(next) })
        .where(eq(schema.workspaceRoleTable.id, row.id));
      updated++;
    }

    await tx
      .insert(schema.rolePermissionBackfillTable)
      .values(pending.map((resource) => ({ resource })))
      .onConflictDoNothing();

    return { pending, updated };
  });

  if (result) {
    console.log(
      `✅ Backfilled role permissions (${result.pending.join(", ")}) into ${result.updated} default role row(s).`,
    );
  }
  return result;
}
