import { defaultRolePayloads } from "@margaya/permissions";
import { describe, expect, it } from "vitest";
import { defaultInviteRole, grantableRoles } from "./grantable-roles";

const seeded = (["viewer", "member", "admin"] as const).map((role) => ({
  role,
  permission: defaultRolePayloads[role],
}));
const workspaceRoles: { role: string; permission: Record<string, string[]> }[] =
  [
    ...seeded,
    { role: "reporter", permission: { task: ["read"], analytics: ["read"] } },
    { role: "auditor", permission: { audit_log: ["read"] } },
  ];

describe("grantableRoles", () => {
  it("offers every role but owner to owners and instance admins", () => {
    const all = ["viewer", "member", "admin", "guest", "reporter", "auditor"];
    expect(grantableRoles({ workspaceRoles, myRole: "owner" })).toEqual(all);
    expect(
      grantableRoles({ workspaceRoles, myRole: "viewer", unlimited: true }),
    ).toEqual(all);
  });

  it("offers only roles within the caller's own statements", () => {
    expect(grantableRoles({ workspaceRoles, myRole: "admin" })).toEqual([
      "viewer",
      "member",
      "admin",
      "guest",
      "reporter",
      "auditor",
    ]);
    expect(grantableRoles({ workspaceRoles, myRole: "member" })).toEqual([
      "viewer",
      "member",
      "guest",
      "reporter",
    ]);
    expect(grantableRoles({ workspaceRoles, myRole: "viewer" })).toEqual([
      "viewer",
    ]);
  });

  it("falls back to the built-in roles while workspace roles are unknown", () => {
    expect(grantableRoles({ workspaceRoles: [], myRole: "member" })).toEqual([
      "viewer",
      "member",
      "guest",
    ]);
    expect(grantableRoles({ workspaceRoles: [], myRole: undefined })).toEqual(
      [],
    );
  });

  it("defaults to member, else the first offered role", () => {
    expect(defaultInviteRole(["viewer", "member"])).toBe("member");
    expect(defaultInviteRole(["viewer"])).toBe("viewer");
    expect(defaultInviteRole([])).toBeUndefined();
  });
});
