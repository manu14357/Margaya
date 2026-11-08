import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  cycle: ["create", "read", "update", "delete"],
  module: ["create", "read", "update", "delete"],
  view: ["create", "read", "update", "delete"],
  // create: submit requests; read: see the whole queue, not only your own;
  // triage: accept, decline, snooze, mark duplicate and reopen.
  intake: ["create", "read", "triage"],
  // Workspace and project analytics; viewers do not get it by default.
  analytics: ["read"],
  // update: edit pages, and lock, archive or move your own; delete: manage
  // (lock, archive, move, delete) any page you can see.
  page: ["create", "read", "update", "delete"],
  // The workspace audit log; owners and admins only by default.
  audit_log: ["read"],
  // use: AI features (only while AI is on for the instance, workspace and
  // project); manage: the workspace's AI settings, keys, caps and usage.
  ai: ["use", "manage"],
} as const;

export const ac = createAccessControl(statement);

export const viewer = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  task: ["read"],
  label: ["read"],
  workspace: ["read"],
  cycle: ["read"],
  module: ["read"],
  view: ["read"],
  intake: ["create", "read"],
  page: ["read"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  project: ["create", "read"],
  task: ["create", "read", "update"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
  cycle: ["create", "read", "update"],
  module: ["create", "read", "update"],
  view: ["create", "read", "update"],
  intake: ["create", "read", "triage"],
  analytics: ["read"],
  page: ["create", "read", "update"],
  ai: ["use"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "manage_settings"],
  cycle: ["create", "read", "update", "delete"],
  module: ["create", "read", "update", "delete"],
  view: ["create", "read", "update", "delete"],
  intake: ["create", "read", "triage"],
  analytics: ["read"],
  page: ["create", "read", "update", "delete"],
  audit_log: ["read"],
  ai: ["use", "manage"],
});

export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
  cycle: ["create", "read", "update", "delete"],
  module: ["create", "read", "update", "delete"],
  view: ["create", "read", "update", "delete"],
  intake: ["create", "read", "triage"],
  analytics: ["read"],
  page: ["create", "read", "update", "delete"],
  audit_log: ["read"],
  ai: ["use", "manage"],
});

// A guest reaches only the projects they are added to, and nothing else in
// the workspace: the API fences that (apps/api/src/project/visibility.ts), so
// no statement here can widen it. Inside a project their project role caps
// these rights, so a guest added as viewer only reads and one added as member
// can also add and edit tasks and comment. It holds no settings, invitation or
// member rights, and stays static so it can't be edited into a wider role.
export const guest = ac.newRole({
  project: ["read"],
  task: ["create", "read", "update"],
  label: ["read"],
  cycle: ["read"],
  module: ["read"],
  view: ["read"],
  page: ["read"],
});

export const builtInRoles = { guest, viewer, member, admin, owner } as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

export const GUEST_ROLE = "guest";

/** Whether a stored role ("a" or "a,b") makes its holder a guest. */
export function isGuestRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return role.split(",").some((name) => name.trim() === GUEST_ROLE);
}

// Default-role names that the API seeds per workspace. These ARE editable in
// the UI (their permissions live as rows in `workspace_role`), but their names
// are reserved and the rows are auto-created on workspace creation /
// backfilled at boot. `owner` is intentionally NOT in this list because it
// stays a true static role on the better-auth side.
export const DEFAULT_ROLE_NAMES = ["viewer", "member", "admin"] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

function toMutablePayload(
  statements: Record<string, readonly string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statements)) {
    out[resource] = [...actions];
  }
  return out;
}

// Plain JSON-serializable permission payloads for the seeded default roles.
// Mirrors each role's `.statements` (including better-auth's organization/
// member/team/invitation/ac defaults) so a workspace_role row that uses one
// of these has parity with the prior static definition.
export const defaultRolePayloads: Record<
  DefaultRoleName,
  Record<string, string[]>
> = {
  viewer: toMutablePayload(viewer.statements),
  member: toMutablePayload(member.statements),
  admin: toMutablePayload(admin.statements),
};

export type PermissionStatements = Record<string, readonly string[]>;

/** Every action granted by any of the sets (a member may hold "a,b" roles). */
export function mergeStatements(
  ...sets: PermissionStatements[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const set of sets) {
    for (const [resource, actions] of Object.entries(set)) {
      const merged = new Set([...(out[resource] ?? []), ...actions]);
      out[resource] = [...merged];
    }
  }
  return out;
}

/**
 * The role ceiling for invitations: a role is within yours when every
 * resource action it grants is one your own role grants too. Built-in and
 * custom roles follow the same rule, so an edited `member` row that gains an
 * action an admin lacks is above that admin. Owners and instance admins skip
 * the check entirely (the caller decides that).
 */
export function grantsWithin(
  candidate: PermissionStatements,
  ceiling: PermissionStatements,
): boolean {
  for (const [resource, actions] of Object.entries(candidate)) {
    const allowed = ceiling[resource] ?? [];
    for (const action of actions) {
      if (!allowed.includes(action)) return false;
    }
  }
  return true;
}
