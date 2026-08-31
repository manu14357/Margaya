import { describe, expect, it } from "vitest";
import {
  ac,
  admin,
  builtInRoles,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  member,
  owner,
  statement,
  viewer,
} from "./index";

describe("@margaya/permissions statement surface", () => {
  it("exposes Margaya's resource statements alongside better-auth defaults", () => {
    expect(statement.project).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "share",
    ]);
    expect(statement.task).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "assign",
    ]);
    expect(statement.label).toEqual(["create", "read", "update", "delete"]);
    expect(statement.workspace).toEqual([
      "read",
      "update",
      "delete",
      "manage_settings",
    ]);
    expect(statement.cycle).toEqual(["create", "read", "update", "delete"]);
    expect(statement.module).toEqual(["create", "read", "update", "delete"]);
    expect(statement.view).toEqual(["create", "read", "update", "delete"]);
    expect(statement.intake).toEqual(["create", "read", "triage"]);
    expect(statement.analytics).toEqual(["read"]);
    expect(statement.page).toEqual(["create", "read", "update", "delete"]);
    // The organization plugin's defaults must still be present so we can
    // reuse them in member/admin/owner roles without breaking better-auth
    // checks like organization:update.
    expect(statement.organization).toBeDefined();
    expect(statement.member).toBeDefined();
  });

  it("returns the same `ac` instance for downstream consumers", () => {
    expect(ac).toBeDefined();
    expect(typeof ac.newRole).toBe("function");
  });
});

describe("built-in role privileges", () => {
  it("viewer can read but cannot create or modify", () => {
    expect(viewer.statements.project).toEqual(["read"]);
    expect(viewer.statements.task).toEqual(["read"]);
    expect(viewer.statements.label).toEqual(["read"]);
    expect(viewer.statements.workspace).toEqual(["read"]);
    expect(viewer.statements.cycle).toEqual(["read"]);
    expect(viewer.statements.module).toEqual(["read"]);
    expect(viewer.statements.view).toEqual(["read"]);
    // Viewers may file intake requests and see the queue, not triage it.
    expect(viewer.statements.intake).toEqual(["create", "read"]);
    // Per-person numbers stay with members and up unless an admin grants them.
    expect(viewer.statements).not.toHaveProperty("analytics");
    expect(defaultRolePayloads.viewer).not.toHaveProperty("analytics");
  });

  it("grants pages by role: viewers read, members edit, admins manage", () => {
    expect(viewer.statements.page).toEqual(["read"]);
    expect(member.statements.page).toEqual(["create", "read", "update"]);
    expect(admin.statements.page).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(owner.statements.page).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(defaultRolePayloads.viewer.page).toEqual(["read"]);
    expect(defaultRolePayloads.member.page).toEqual([
      "create",
      "read",
      "update",
    ]);
    expect(defaultRolePayloads.admin.page).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
  });

  it("member, admin and owner can read analytics", () => {
    expect(member.statements.analytics).toEqual(["read"]);
    expect(admin.statements.analytics).toEqual(["read"]);
    expect(owner.statements.analytics).toEqual(["read"]);
    expect(defaultRolePayloads.member.analytics).toEqual(["read"]);
    expect(defaultRolePayloads.admin.analytics).toEqual(["read"]);
  });

  it("member can create/read/update tasks but not delete or manage settings", () => {
    expect(member.statements.task).toContain("create");
    expect(member.statements.task).toContain("update");
    expect(member.statements.task).not.toContain("delete");
    expect(member.statements.project).toContain("create");
    expect(member.statements.project).not.toContain("delete");
    expect(member.statements.workspace).toEqual(["read"]);
    expect(member.statements.cycle).toEqual(["create", "read", "update"]);
    expect(member.statements.module).toEqual(["create", "read", "update"]);
    expect(member.statements.view).toEqual(["create", "read", "update"]);
    expect(member.statements.intake).toEqual(["create", "read", "triage"]);
  });

  it("admin can delete tasks and manage workspace settings but cannot delete the workspace", () => {
    expect(admin.statements.task).toContain("delete");
    expect(admin.statements.task).toContain("assign");
    expect(admin.statements.project).toContain("delete");
    expect(admin.statements.project).toContain("share");
    expect(admin.statements.workspace).toContain("manage_settings");
    expect(admin.statements.workspace).not.toContain("delete");
    expect(admin.statements.cycle).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(admin.statements.module).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(admin.statements.view).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(admin.statements.intake).toEqual(["create", "read", "triage"]);
  });

  it("owner has every Margaya resource action including workspace:delete", () => {
    expect(owner.statements.task).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete", "assign"]),
    );
    expect(owner.statements.project).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete", "share"]),
    );
    expect(owner.statements.workspace).toEqual(
      expect.arrayContaining(["read", "update", "delete", "manage_settings"]),
    );
    expect(owner.statements.cycle).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
    expect(owner.statements.module).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
    expect(owner.statements.view).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
    expect(owner.statements.intake).toEqual(
      expect.arrayContaining(["create", "read", "triage"]),
    );
  });

  it("groups all four roles under builtInRoles by name", () => {
    expect(Object.keys(builtInRoles).sort()).toEqual([
      "admin",
      "member",
      "owner",
      "viewer",
    ]);
    expect(builtInRoles.viewer).toBe(viewer);
    expect(builtInRoles.member).toBe(member);
    expect(builtInRoles.admin).toBe(admin);
    expect(builtInRoles.owner).toBe(owner);
  });
});

describe("default-role seed payloads", () => {
  it("names the seedable defaults but excludes owner (kept as static role)", () => {
    expect(DEFAULT_ROLE_NAMES).toEqual(["viewer", "member", "admin"]);
    expect(DEFAULT_ROLE_NAMES).not.toContain("owner");
    expect(Object.keys(defaultRolePayloads).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
  });

  it("emits JSON-serializable payloads that mirror each role's compiled statements", () => {
    for (const name of DEFAULT_ROLE_NAMES) {
      const role = builtInRoles[name];
      const payload = defaultRolePayloads[name];

      // Every resource the compiled role declares must appear in the payload
      // with the same set of actions (order-insensitive). Otherwise a seeded
      // workspace_role row would silently drift from the static role.
      for (const [resource, actions] of Object.entries(role.statements)) {
        expect(payload[resource]).toBeDefined();
        expect([...payload[resource]].sort()).toEqual([...actions].sort());
      }

      // Round-trips through JSON without loss; the API stores these as text.
      const roundTripped = JSON.parse(JSON.stringify(payload));
      expect(roundTripped).toEqual(payload);
    }
  });

  it("returns a fresh mutable array per resource so callers can edit safely", () => {
    const memberPayload = defaultRolePayloads.member;
    memberPayload.task.push("__test_marker");
    // Re-import-equivalent check: the in-memory payload is mutable but the
    // role object's statements are decoupled (we only mutated the copy).
    expect(memberPayload.task).toContain("__test_marker");
    expect(member.statements.task).not.toContain("__test_marker");
  });
});

describe("audit log permission", () => {
  it("is granted to owners and admins only", () => {
    expect(statement.audit_log).toEqual(["read"]);
    expect(owner.statements.audit_log).toEqual(["read"]);
    expect(admin.statements.audit_log).toEqual(["read"]);
    expect(member.statements).not.toHaveProperty("audit_log");
    expect(viewer.statements).not.toHaveProperty("audit_log");
    expect(defaultRolePayloads.admin.audit_log).toEqual(["read"]);
    expect(defaultRolePayloads.member).not.toHaveProperty("audit_log");
  });
});
