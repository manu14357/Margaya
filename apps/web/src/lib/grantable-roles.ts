import {
  builtInRoles,
  DEFAULT_ROLE_NAMES,
  grantsWithin,
  mergeStatements,
  type PermissionStatements,
} from "@margaya/permissions";

type RoleRow = { role: string; permission: Record<string, string[]> };

const RESERVED = new Set<string>([...DEFAULT_ROLE_NAMES, "owner"]);

/**
 * The roles someone holding `myRole` may put on an invitation, mirroring the
 * API's ceiling (apps/api/src/utils/role-ceiling.ts): a role is offered when
 * it grants nothing `myRole` lacks. Owners and instance admins get every
 * role. Owner itself is never offered; it moves only by ownership transfer.
 * The API remains the authority; this only keeps the select honest.
 */
export function grantableRoles({
  workspaceRoles,
  myRole,
  unlimited = false,
}: {
  workspaceRoles: RoleRow[];
  myRole: string | null | undefined;
  unlimited?: boolean;
}): string[] {
  const statementsOf = (name: string): PermissionStatements | null =>
    workspaceRoles.find((row) => row.role === name)?.permission ??
    (name in builtInRoles
      ? builtInRoles[name as keyof typeof builtInRoles].statements
      : null);

  const candidates = [
    ...DEFAULT_ROLE_NAMES,
    ...workspaceRoles
      .map((row) => row.role)
      .filter((name) => !RESERVED.has(name)),
  ];

  const mine = (myRole ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (unlimited || mine.includes("owner")) return candidates;
  if (mine.length === 0) return [];

  const ceiling = mergeStatements(
    ...mine.map(statementsOf).filter((s): s is PermissionStatements => !!s),
  );
  return candidates.filter((name) => {
    const statements = statementsOf(name);
    return statements !== null && grantsWithin(statements, ceiling);
  });
}

/** Member when it can be granted, else the lowest offered role. */
export function defaultInviteRole(roles: string[]): string | undefined {
  return roles.includes("member") ? "member" : roles[0];
}
