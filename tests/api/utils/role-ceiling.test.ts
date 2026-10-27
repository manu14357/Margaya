import { beforeEach, describe, expect, it, vi } from "vitest";
import { builtInRoles } from "../../../packages/permissions/src";

const { state } = vi.hoisted(() => ({
  state: {
    memberRole: null as string | null,
    workspaceRoles: {} as Record<string, Record<string, string[]>>,
  },
}));

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => (state.memberRole ? [{ role: state.memberRole }] : []),
  };
  return { default: chain, schema };
});

vi.mock("../../../apps/api/src/utils/require-workspace-permission", () => ({
  customRoleStatements: async (_workspaceId: string, role: string) =>
    state.workspaceRoles[role] ?? null,
  builtInRoleStatements: (role: string) =>
    role in builtInRoles
      ? builtInRoles[role as keyof typeof builtInRoles].statements
      : null,
}));

const { roleCeilingError, splitRoles } = await import(
  "../../../apps/api/src/utils/role-ceiling"
);

const check = (roles: string[], instanceAdmin = false) =>
  roleCeilingError({
    workspaceId: "ws-1",
    userId: "user-1",
    roles,
    instanceAdmin,
  });

beforeEach(() => {
  state.memberRole = null;
  state.workspaceRoles = {};
});

describe("splitRoles", () => {
  it("reads a name, a comma list or an array", () => {
    expect(splitRoles("member")).toEqual(["member"]);
    expect(splitRoles(" admin, member ")).toEqual(["admin", "member"]);
    expect(splitRoles(["viewer", "a,b"])).toEqual(["viewer", "a", "b"]);
    expect(splitRoles(undefined)).toEqual([]);
  });
});

describe("roleCeilingError", () => {
  it("lets a member grant member and viewer but not admin or owner", async () => {
    state.memberRole = "member";
    expect(await check(["viewer"])).toBeNull();
    expect(await check(["member"])).toBeNull();
    expect(await check(["admin"])).toMatchObject({ status: 403 });
    expect(await check(["owner"])).toMatchObject({ status: 403 });
  });

  it("lets an admin grant up to admin", async () => {
    state.memberRole = "admin";
    expect(await check(["viewer"])).toBeNull();
    expect(await check(["admin"])).toBeNull();
    expect(await check(["owner"])).toMatchObject({ status: 403 });
  });

  it("compares custom roles by their statements", async () => {
    state.memberRole = "member";
    state.workspaceRoles = {
      reporter: { task: ["read"], analytics: ["read"] },
      auditor: { audit_log: ["read"] },
    };
    expect(await check(["reporter"])).toBeNull();
    expect(await check(["auditor"])).toMatchObject({ status: 403 });
  });

  it("uses the workspace's edited default roles", async () => {
    // An admin whose role was narrowed below the default member role.
    state.memberRole = "admin";
    state.workspaceRoles = { admin: { task: ["read"] } };
    expect(await check(["member"])).toMatchObject({ status: 403 });
  });

  it("refuses unknown and missing roles with 400", async () => {
    state.memberRole = "admin";
    expect(await check(["ghost"])).toMatchObject({ status: 400 });
    expect(await check([])).toMatchObject({ status: 400 });
  });

  it("gives owners and instance admins no ceiling", async () => {
    state.memberRole = "owner";
    expect(await check(["admin"])).toBeNull();
    state.memberRole = "viewer";
    expect(await check(["admin"], true)).toBeNull();
  });

  it("leaves non-members to the endpoint's own checks", async () => {
    expect(await check(["admin"])).toBeNull();
  });
});
