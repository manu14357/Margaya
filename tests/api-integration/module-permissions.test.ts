import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember } from "./helpers/fixtures";
import { json, moduleContext } from "./helpers/modules";

const FEATURE_OFF = "The Modules feature is turned off for this project.";

async function permissionFixture() {
  const ctx = await moduleContext("admin");
  const billing = await ctx.createModule({ name: "Billing" });
  const done = await ctx.insertModule({ name: "Done", status: "completed" });
  const task = await ctx.createTask();
  await ctx.link(billing.id, [task.id]);
  const [link] = await db
    .insert(schema.moduleLinkTable)
    .values({ moduleId: billing.id, url: "https://example.com/" })
    .returning();
  if (!link) throw new Error("fixture");
  const p = ctx.project.id;

  const reads: Record<string, [string, RequestInit | undefined]> = {
    listModules: [`/project/${p}`, undefined],
    getModuleTaskMap: [`/project/${p}/task-map`, undefined],
    getTaskModules: [`/task/${task.id}`, undefined],
    getModule: [`/${billing.id}`, undefined],
    getModuleProgress: [`/${billing.id}/progress`, undefined],
    listModuleTasks: [`/${billing.id}/tasks`, undefined],
    listModuleLinks: [`/${billing.id}/links`, undefined],
  };
  const writes: Record<string, [string, RequestInit]> = {
    createModule: [`/project/${p}`, json("POST", { name: "New" })],
    reorderModules: [
      `/project/${p}/reorder`,
      json("PUT", { modules: [{ id: billing.id, position: 0 }] }),
    ],
    setTaskModules: [
      `/task/${task.id}`,
      json("PUT", { removeModuleIds: [billing.id] }),
    ],
    updateModule: [`/${billing.id}`, json("PUT", { name: "X" })],
    archiveModule: [`/${done.id}/archive`, { method: "POST" }],
    unarchiveModule: [`/${done.id}/unarchive`, { method: "POST" }],
    addModuleTasks: [
      `/${billing.id}/tasks`,
      json("POST", { taskIds: [task.id] }),
    ],
    removeModuleTasks: [
      `/${billing.id}/tasks`,
      json("DELETE", { taskIds: [task.id] }),
    ],
    createModuleLink: [
      `/${billing.id}/links`,
      json("POST", { url: "example.org" }),
    ],
    updateModuleLink: [
      `/${billing.id}/links/${link.id}`,
      json("PUT", { title: "Spec" }),
    ],
    deleteModuleLink: [`/${billing.id}/links/${link.id}`, { method: "DELETE" }],
    deleteModule: [`/${billing.id}`, { method: "DELETE" }],
  };
  return { ...ctx, billing, task, reads, writes };
}

describe("API integration: module permissions and boundaries", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires a session", async () => {
    const { request, project } = await permissionFixture();
    mockAnonymousSession();
    expect((await request(`/project/${project.id}`)).status).toBe(401);
  });

  it("lets viewers read but not change modules", async () => {
    const { workspace, request, reads, writes } = await permissionFixture();
    mockAuthenticatedSession(await addWorkspaceMember(workspace.id, "viewer"));

    for (const [name, [path, init]] of Object.entries(reads)) {
      expect((await request(path, init)).status, name).toBe(200);
    }
    for (const [name, [path, init]] of Object.entries(writes)) {
      const response = await request(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe("Insufficient permissions");
    }
  });

  it("lets members plan modules but only delete their own", async () => {
    const { workspace, request, writes } = await permissionFixture();
    mockAuthenticatedSession(await addWorkspaceMember(workspace.id, "member"));

    const { deleteModule, ...others } = writes;
    for (const [name, [path, init]] of Object.entries(others)) {
      const response = await request(path, init);
      expect(response.status, `${name}: ${await response.text()}`).toBe(200);
    }
    // Not the creator and no module:delete.
    expect((await request(...deleteModule)).status).toBe(403);
  });

  it("keeps outsiders and other workspaces out", async () => {
    const { request, reads, writes } = await permissionFixture();
    const outsider = await moduleContext("owner");
    const theirs = await outsider.createModule({ name: "Theirs" });
    const theirTask = await outsider.createTask();

    // The outsider's session against our resources.
    for (const [name, [path, init]] of Object.entries({
      ...reads,
      ...writes,
    })) {
      const response = await request(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).not.toContain("Billing");
    }

    // Our session against theirs.
    const ours = await permissionFixture();
    for (const path of [
      `/${theirs.id}`,
      `/${theirs.id}/progress`,
      `/project/${outsider.project.id}`,
      `/task/${theirTask.id}`,
    ]) {
      expect((await ours.request(path)).status, path).toBe(403);
    }
    // Their module through our task: indistinguishable from a missing one.
    const smuggled = await ours.request(
      `/task/${ours.task.id}`,
      json("PUT", { addModuleIds: [theirs.id] }),
    );
    expect(smuggled.status).toBe(400);
    // Their task ids are ignored by our module.
    const ignored = await ours.request(
      `/${ours.billing.id}/tasks`,
      json("POST", { taskIds: [theirTask.id] }),
    );
    expect(await ignored.json()).toMatchObject({ ignored: [theirTask.id] });
    expect((await ours.request("/unknown-module")).status).toBe(404);
  });

  it("follows custom role statements", async () => {
    const { workspace, request, reads, writes } = await permissionFixture();
    const planner = await addWorkspaceMember(workspace.id, "planner");
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: "planner",
      permission: JSON.stringify({ project: ["read"], task: ["read"] }),
    });
    mockAuthenticatedSession(planner);
    expect((await request(...reads.listModules)).status).toBe(403);

    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({
          project: ["read"],
          module: ["read", "update", "delete"],
        }),
      })
      .where(eq(schema.workspaceRoleTable.role, "planner"));
    expect((await request(...reads.listModules)).status).toBe(200);
    expect((await request(...writes.createModule)).status).toBe(403);
    // module:delete deletes any module.
    expect((await request(...writes.deleteModule)).status).toBe(200);
  });

  it("honors API key scopes", async () => {
    const { user, reads, writes } = await permissionFixture();
    mockAnonymousSession();
    const key = `margaya_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: user.id,
      userId: user.id,
      key: createHash("sha256").update(key).digest("base64url"),
      name: "module reader",
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify({ project: ["read"], module: ["read"] }),
      enabled: true,
    });
    const { app } = createApp();
    const call = (path: string, init?: RequestInit) =>
      app.request(`/api/module${path}`, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${key}`,
        },
      });

    expect((await call(...reads.listModules)).status).toBe(200);
    expect((await call(...reads.getModuleProgress)).status).toBe(200);
    for (const name of ["createModule", "updateModule", "addModuleTasks"]) {
      const [path, init] = writes[name] as [string, RequestInit];
      const response = await call(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe("Insufficient API key scope");
    }
  });

  it("answers 403 on every route while the feature is off, and keeps data", async () => {
    const { app, request, project, reads, writes, billing } =
      await permissionFixture();
    const setFeature = async (modulesEnabled: boolean) => {
      const response = await app.request(
        `/api/project/${project.id}/features`,
        json("PATCH", { modulesEnabled }),
      );
      expect(response.status).toBe(200);
    };
    await setFeature(false);

    const routes = { ...reads, ...writes };
    expect(Object.keys(routes)).toHaveLength(19);
    for (const [name, [path, init]] of Object.entries(routes)) {
      const response = await request(path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe(FEATURE_OFF);
    }

    await setFeature(true);
    expect((await request(`/${billing.id}`)).status).toBe(200);
  });
});
