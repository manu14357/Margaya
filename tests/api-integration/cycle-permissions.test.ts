import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function permissionFixture() {
  const ctx = await cycleContext("admin");
  const cycle = await ctx.createCycle({ name: "Sprint" });
  const done = await ctx.insertCycle({
    name: "Done",
    startDate: day(-10),
    endDate: day(-1),
  });
  const task = await ctx.createTask();

  const reads = {
    list: () => ctx.app.request(`/api/cycle/project/${ctx.project.id}`),
    get: () => ctx.app.request(`/api/cycle/${cycle.id}`),
    progress: () => ctx.app.request(`/api/cycle/${cycle.id}/progress`),
  };
  const writes = {
    create: () =>
      ctx.app.request(
        `/api/cycle/project/${ctx.project.id}`,
        json("POST", { name: "New" }),
      ),
    update: () =>
      ctx.app.request(`/api/cycle/${cycle.id}`, json("PUT", { name: "X" })),
    add: () =>
      ctx.app.request(
        `/api/cycle/${cycle.id}/tasks`,
        json("POST", { taskIds: [task.id] }),
      ),
    setTask: () =>
      ctx.app.request(
        `/api/cycle/task/${task.id}`,
        json("PUT", { cycleId: cycle.id }),
      ),
    transfer: () =>
      ctx.app.request(
        `/api/cycle/${done.id}/transfer`,
        json("POST", { targetCycleId: cycle.id }),
      ),
    remove: () =>
      ctx.app.request(
        `/api/cycle/${cycle.id}/tasks`,
        json("DELETE", { taskIds: [task.id] }),
      ),
    delete: () =>
      ctx.app.request(`/api/cycle/${cycle.id}`, { method: "DELETE" }),
  };
  return { ...ctx, cycle, reads, writes };
}

describe("API integration: cycle permissions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets viewers read but not change cycles", async () => {
    const { workspace, reads, writes } = await permissionFixture();
    mockAuthenticatedSession(await addWorkspaceMember(workspace.id, "viewer"));

    for (const [name, request] of Object.entries(reads)) {
      expect((await request()).status, name).toBe(200);
    }
    for (const [name, request] of Object.entries(writes)) {
      const response = await request();
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe("Insufficient permissions");
    }
  });

  it("lets members plan cycles", async () => {
    const { workspace, writes } = await permissionFixture();
    mockAuthenticatedSession(await addWorkspaceMember(workspace.id, "member"));

    expect((await writes.create()).status).toBe(200);
    expect((await writes.update()).status).toBe(200);
    expect((await writes.add()).status).toBe(200);
    expect((await writes.setTask()).status).toBe(200);
    expect((await writes.transfer()).status).toBe(200);
    expect((await writes.remove()).status).toBe(200);
    // Not the owner and no cycle:delete.
    expect((await writes.delete()).status).toBe(403);
  });

  it("follows custom role statements", async () => {
    const { workspace, reads, writes } = await permissionFixture();
    const limited = await addWorkspaceMember(workspace.id, "planner");
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId: workspace.id,
        role: "planner",
        permission: JSON.stringify({ project: ["read"], task: ["read"] }),
      },
    ]);
    mockAuthenticatedSession(limited);
    expect((await reads.list()).status).toBe(403);
    expect((await reads.get()).status).toBe(403);
    expect((await writes.create()).status).toBe(403);

    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({
          project: ["read"],
          cycle: ["read", "delete", "update"],
        }),
      })
      .where(eq(schema.workspaceRoleTable.role, "planner"));
    expect((await reads.list()).status).toBe(200);
    expect((await writes.create()).status).toBe(403);
    // cycle:delete deletes any cycle.
    expect((await writes.delete()).status).toBe(200);
  });

  it("honors API key scopes", async () => {
    const { user, project, cycle } = await permissionFixture();
    mockAnonymousSession();
    const key = `margaya_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: user.id,
      userId: user.id,
      key: createHash("sha256").update(key).digest("base64url"),
      name: "cycle reader",
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: JSON.stringify({ project: ["read"], cycle: ["read"] }),
      enabled: true,
    });
    const headers = { Authorization: `Bearer ${key}` };
    const { app } = createApp();

    const list = await app.request(`/api/cycle/project/${project.id}`, {
      headers,
    });
    expect(list.status).toBe(200);
    const progress = await app.request(`/api/cycle/${cycle.id}/progress`, {
      headers,
    });
    expect(progress.status).toBe(200);

    const denied = await app.request(`/api/cycle/project/${project.id}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("Insufficient API key scope");
  });

  it("keeps cycles inside their workspace", async () => {
    const { app, cycle, reads } = await permissionFixture();
    const outsider = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(outsider.user);

    expect((await reads.get()).status).toBe(403);
    expect((await reads.progress()).status).toBe(403);
    expect((await reads.list()).status).toBe(403);
    expect(
      (
        await app.request(
          `/api/cycle/${cycle.id}/tasks`,
          json("POST", { taskIds: ["x"] }),
        )
      ).status,
    ).toBe(403);

    // An outsider can't pull a foreign cycle into their own task either.
    const own = await createProjectFixture({
      workspaceId: outsider.workspace.id,
      slug: "own",
    });
    const [ownTask] = await db
      .insert(schema.taskTable)
      .values({ projectId: own.project.id, title: "Mine", number: 1 })
      .returning();
    const cross = await app.request(
      `/api/cycle/task/${ownTask?.id}`,
      json("PUT", { cycleId: cycle.id }),
    );
    expect(cross.status).toBe(404);
  });

  it("answers 404 for unknown cycles and 401 without a session", async () => {
    const { app, cycle } = await permissionFixture();
    const unknown = await app.request("/api/cycle/unknown-cycle");
    expect(unknown.status).toBe(404);

    mockAnonymousSession();
    expect((await app.request(`/api/cycle/${cycle.id}`)).status).toBe(401);
  });
});
