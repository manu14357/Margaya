import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { backfillRolePermissions } from "../../apps/api/src/utils/backfill-role-permissions";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Rows as they were seeded before the cycle and module resources existed.
const LEGACY = {
  viewer: { project: ["read"], task: ["read"], workspace: ["read"] },
  member: {
    project: ["create", "read"],
    task: ["create", "read", "update"],
    workspace: ["read"],
  },
  admin: {
    project: ["create", "read", "update", "delete", "share"],
    task: ["create", "read", "update", "delete", "assign"],
    workspace: ["read", "update", "manage_settings"],
  },
};

async function seedLegacyRoles(workspaceId: string) {
  await db.insert(schema.workspaceRoleTable).values([
    ...Object.entries(LEGACY).map(([role, permission]) => ({
      workspaceId,
      role,
      permission: JSON.stringify(permission),
    })),
    {
      workspaceId,
      role: "reporter",
      permission: JSON.stringify({ project: ["read"] }),
    },
  ]);
}

async function storedPermissions(workspaceId: string) {
  const rows = await db
    .select()
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));
  return Object.fromEntries(
    rows.map((row) => [row.role, JSON.parse(row.permission)]),
  ) as Record<string, Record<string, string[]>>;
}

describe("API integration: role permission backfill", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("adds new resources to existing default roles once", async () => {
    const { workspace, user } = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await seedLegacyRoles(workspace.id);
    mockAuthenticatedSession(user);
    const { app } = createApp();

    // Without the backfill, the stored row wins and both features answer 403.
    const before = await app.request(`/api/cycle/project/${project.id}`);
    expect(before.status).toBe(403);
    const modulesBefore = await app.request(
      `/api/module/project/${project.id}`,
    );
    expect(modulesBefore.status).toBe(403);

    const result = await backfillRolePermissions();
    expect(result).toEqual({
      pending: [
        "analytics",
        "audit_log",
        "cycle",
        "intake",
        "module",
        "page",
        "view",
      ],
      updated: 3,
    });

    const stored = await storedPermissions(workspace.id);
    expect(stored.viewer?.cycle).toEqual(["read"]);
    expect(stored.member?.cycle).toEqual(["create", "read", "update"]);
    expect(stored.admin?.cycle).toEqual(["create", "read", "update", "delete"]);
    expect(stored.viewer?.module).toEqual(["read"]);
    expect(stored.member?.module).toEqual(["create", "read", "update"]);
    expect(stored.admin?.module).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
    expect(stored.viewer?.intake).toEqual(["create", "read"]);
    expect(stored.member?.intake).toEqual(["create", "read", "triage"]);
    expect(stored.member?.analytics).toEqual(["read"]);
    expect(stored.admin?.analytics).toEqual(["read"]);
    // Viewers get no analytics by default.
    expect(stored.viewer).not.toHaveProperty("analytics");
    // The audit log is for admins (and the static owner role) only.
    expect(stored.admin?.audit_log).toEqual(["read"]);
    expect(stored.member).not.toHaveProperty("audit_log");
    expect(stored.viewer).not.toHaveProperty("audit_log");
    expect(stored.viewer?.page).toEqual(["read"]);
    expect(stored.member?.page).toEqual(["create", "read", "update"]);
    expect(stored.admin?.page).toEqual(["create", "read", "update", "delete"]);
    // Other resources and custom roles are untouched.
    expect(stored.member?.task).toEqual(LEGACY.member.task);
    expect(stored.reporter).toEqual({ project: ["read"] });

    const after = await app.request(`/api/cycle/project/${project.id}`);
    expect(after.status).toBe(200);
    const modulesAfter = await app.request(`/api/module/project/${project.id}`);
    expect(modulesAfter.status).toBe(200);

    const applied = await db.select().from(schema.rolePermissionBackfillTable);
    expect(applied.map((row) => row.resource).sort()).toEqual([
      "analytics",
      "audit_log",
      "cycle",
      "intake",
      "module",
      "page",
      "view",
    ]);
  });

  it("is idempotent and never re-adds a resource an admin removed", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await seedLegacyRoles(workspace.id);
    await backfillRolePermissions();

    // An admin takes cycles away from members.
    const { cycle: _removed, ...withoutCycles } = (
      await storedPermissions(workspace.id)
    ).member as Record<string, string[]>;
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify(withoutCycles) })
      .where(eq(schema.workspaceRoleTable.role, "member"));

    expect(await backfillRolePermissions()).toBeNull();
    expect((await storedPermissions(workspace.id)).member).toEqual(
      withoutCycles,
    );
  });

  it("keeps rows that already have the resource and skips unreadable ones", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: workspace.id,
        role: "viewer",
        permission: JSON.stringify({
          project: ["read"],
          cycle: [],
          module: [],
          view: [],
          intake: [],
          page: [],
        }),
      },
      { workspaceId: workspace.id, role: "member", permission: "not json" },
    ]);

    expect(await backfillRolePermissions()).toEqual({
      pending: [
        "analytics",
        "audit_log",
        "cycle",
        "intake",
        "module",
        "page",
        "view",
      ],
      updated: 0,
    });
    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(Object.fromEntries(rows.map((r) => [r.role, r.permission]))).toEqual(
      {
        viewer: JSON.stringify({
          project: ["read"],
          cycle: [],
          module: [],
          view: [],
          intake: [],
          page: [],
        }),
        member: "not json",
      },
    );
  });

  it("covers workspaces seeded after the upgrade", async () => {
    await backfillRolePermissions();
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await seedDefaultWorkspaceRoles();

    // New rows come with every resource, so nothing is left to backfill.
    const viewer = (await storedPermissions(workspace.id)).viewer;
    expect(viewer?.cycle).toEqual(["read"]);
    expect(viewer?.module).toEqual(["read"]);
    expect(viewer?.view).toEqual(["read"]);
    expect(viewer?.intake).toEqual(["create", "read"]);
    expect(await backfillRolePermissions()).toBeNull();
  });
});
