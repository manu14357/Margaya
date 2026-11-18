import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { statement } from "../../packages/permissions/src";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Permissions = {
  workspaceId: string;
  userId: string;
  role: string;
  joinedAt: string;
  permissions: Record<string, string[]>;
};

async function readPermissions(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  init?: RequestInit,
) {
  return app.request(`/api/workspace/${workspaceId}/permissions`, init);
}

async function permissionsOf(
  app: ReturnType<typeof createApp>["app"],
  user: typeof schema.userTable.$inferSelect,
  workspaceId: string,
) {
  mockAuthenticatedSession(user);
  const response = await readPermissions(app, workspaceId);
  expect(response.status).toBe(200);
  return (await response.json()) as Permissions;
}

async function storeRole(
  workspaceId: string,
  role: string,
  permission: Record<string, string[]>,
) {
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role,
    permission: JSON.stringify(permission),
  });
}

describe("API integration: GET /api/workspace/{id}/permissions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers every built-in role with what the role grants", async () => {
    const { app } = createApp();
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const admin = await addWorkspaceMember(workspace.id, "admin");
    const member = await addWorkspaceMember(workspace.id, "member");
    const viewer = await addWorkspaceMember(workspace.id, "viewer");

    const ownerView = await permissionsOf(app, owner, workspace.id);
    expect(ownerView).toMatchObject({
      workspaceId: workspace.id,
      userId: owner.id,
      role: "owner",
    });
    expect(Number.isNaN(Date.parse(ownerView.joinedAt))).toBe(false);
    expect(ownerView.permissions.workspace).toEqual(
      expect.arrayContaining(["update", "delete", "manage_settings"]),
    );
    expect(ownerView.permissions.audit_log).toEqual(["read"]);

    const adminView = await permissionsOf(app, admin, workspace.id);
    expect(adminView.role).toBe("admin");
    expect(adminView.permissions.workspace).not.toContain("delete");
    expect(adminView.permissions.member).toEqual(
      expect.arrayContaining(["update", "delete"]),
    );

    const memberView = await permissionsOf(app, member, workspace.id);
    expect(memberView.role).toBe("member");
    expect(memberView.permissions.task).toEqual(
      expect.arrayContaining(["create", "read", "update"]),
    );
    expect(memberView.permissions.task).not.toContain("delete");
    expect(memberView.permissions.audit_log).toBeUndefined();

    const viewerView = await permissionsOf(app, viewer, workspace.id);
    expect(viewerView.role).toBe("viewer");
    expect(viewerView.permissions.task).toEqual(["read"]);
    expect(viewerView.permissions.project).toEqual(["read"]);
    expect(viewerView.permissions.analytics).toBeUndefined();
  });

  it("only reports actions of the permission vocabulary", async () => {
    const { app } = createApp();
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const view = await permissionsOf(app, user, workspace.id);
    for (const [resource, actions] of Object.entries(view.permissions)) {
      const known = (statement as Record<string, readonly string[]>)[resource];
      expect(known, resource).toBeDefined();
      for (const action of actions) expect(known).toContain(action);
    }
  });

  it("resolves a custom role and an edited default role from their stored rows", async () => {
    const { app } = createApp();
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    await storeRole(workspace.id, "triager", {
      project: ["read"],
      task: ["read", "update"],
      intake: ["create", "read", "triage"],
    });
    // An admin took task:create away from the workspace's members.
    await storeRole(workspace.id, "member", {
      project: ["read"],
      task: ["read", "update"],
    });
    const triager = await addWorkspaceMember(workspace.id, "triager");
    const member = await addWorkspaceMember(workspace.id, "member");

    const triagerView = await permissionsOf(app, triager, workspace.id);
    expect(triagerView.role).toBe("triager");
    expect(triagerView.permissions).toEqual({
      project: ["read"],
      task: ["read", "update"],
      intake: ["create", "read", "triage"],
    });

    const memberView = await permissionsOf(app, member, workspace.id);
    expect(memberView.permissions.task).toEqual(["read", "update"]);

    // The answer matches what the API enforces on the same role.
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    mockAuthenticatedSession(member);
    const create = await app.request(`/api/task/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Probe",
        description: "",
        priority: "low",
        status: "to-do",
      }),
    });
    expect(create.status).toBe(403);
  });

  it("answers a guest with the guest role", async () => {
    const { app } = createApp();
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const guest = await addWorkspaceMember(workspace.id, "guest");

    const view = await permissionsOf(app, guest, workspace.id);
    expect(view.role).toBe("guest");
    expect(view.permissions.workspace ?? []).not.toContain("update");
    expect(view.permissions.member).toBeUndefined();
  });

  it("refuses non-members, signed-out callers and API keys", async () => {
    const { app } = createApp();
    const { user: owner, workspace } = await createWorkspaceMember({
      role: "owner",
    });
    const { user: outsider } = await createWorkspaceMember();

    mockAuthenticatedSession(outsider);
    expect((await readPermissions(app, workspace.id)).status).toBe(403);
    expect((await readPermissions(app, "workspace-missing")).status).toBe(403);

    mockAnonymousSession();
    expect((await readPermissions(app, workspace.id)).status).toBe(401);

    const key = await createApiKey(owner);
    mockAnonymousSession();
    const viaKey = await readPermissions(app, workspace.id, {
      headers: key.headers,
    });
    expect(viaKey.status).toBe(403);
  });

  it("gives an instance admin who is a member the API's reach, not the auth routes'", async () => {
    const { app } = createApp();
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const viewer = await addWorkspaceMember(workspace.id, "viewer");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, viewer.id));
    const [adminUser] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, viewer.id));
    if (!adminUser) throw new Error("user missing");

    const view = await permissionsOf(app, adminUser, workspace.id);
    expect(view.role).toBe("viewer");
    // The API's own routes let an instance admin through...
    expect(view.permissions.task).toEqual(
      expect.arrayContaining(["create", "update", "delete"]),
    );
    // ...while invitations and member roles go by the workspace role alone.
    expect(view.permissions.invitation).toBeUndefined();
    expect(view.permissions.member).toBeUndefined();
  });

  it("refuses an instance admin who is not a member", async () => {
    const { app } = createApp();
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const { user } = await createWorkspaceMember();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));

    mockAuthenticatedSession({ ...user, role: "admin" } as typeof user);
    expect((await readPermissions(app, workspace.id)).status).toBe(403);
  });
});
