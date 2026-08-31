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
});

export const builtInRoles = { viewer, member, admin, owner } as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

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
