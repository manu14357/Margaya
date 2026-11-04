import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function createFixture(role?: "member" | "viewer") {
  const member = await createWorkspaceMember(role ? { role } : undefined);
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Loaded title",
      description: "Loaded description",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "low",
      number: 1,
      position: 1,
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    })
    .returning();
  if (!task) throw new Error("no task");
  return { member, project, columns, task };
}

function storedTask(id: string) {
  return db.query.taskTable.findFirst({ where: eq(schema.taskTable.id, id) });
}

async function put(id: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/task/position/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: task position", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a move cannot undo a newer edit made after the board loaded", async () => {
    const { member, task, columns } = await createFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    // A colleague edits the task after this client loaded its board.
    const edits: [string, unknown][] = [
      ["title", { title: "Newer title" }],
      ["description", { description: "Newer description" }],
      ["priority", { priority: "high" }],
      ["due-date", { dueDate: "2031-05-01T00:00:00.000Z" }],
    ];
    for (const [field, body] of edits) {
      const edited = await app.request(`/api/task/${field}/${task.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(edited.status).toBe(200);
    }

    const response = await put(task.id, { status: "done", position: 7 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: task.id,
      title: "Newer title",
      status: "done",
      position: 7,
    });

    const stored = await storedTask(task.id);
    expect(stored).toMatchObject({
      title: "Newer title",
      description: "Newer description",
      priority: "high",
      status: "done",
      columnId: columns.done.id,
      position: 7,
    });
    expect(stored?.dueDate?.toISOString()).toBe("2031-05-01T00:00:00.000Z");
    expect(stored?.completedAt).not.toBeNull();
  });

  it("a reorder writes the position and leaves the rest of the row alone", async () => {
    const { member, task } = await createFixture();
    mockAuthenticatedSession(member.user);
    const before = await storedTask(task.id);

    const response = await put(task.id, { position: 4 });
    expect(response.status).toBe(200);

    expect(await storedTask(task.id)).toEqual({ ...before, position: 4 });
  });

  it("echoing the current status is not a status change", async () => {
    const { member, task } = await createFixture();
    mockAuthenticatedSession(member.user);
    const before = await storedTask(task.id);

    const response = await put(task.id, { status: "to-do", position: 4 });
    expect(response.status).toBe(200);

    expect(await storedTask(task.id)).toEqual({ ...before, position: 4 });
  });

  it("restores an archived task only when it changes column", async () => {
    const { member, task } = await createFixture();
    mockAuthenticatedSession(member.user);
    await db
      .update(schema.taskTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.taskTable.id, task.id));

    expect((await put(task.id, { position: 2 })).status).toBe(200);
    expect((await storedTask(task.id))?.archivedAt).not.toBeNull();

    expect((await put(task.id, { status: "done", position: 0 })).status).toBe(
      200,
    );
    expect((await storedTask(task.id))?.archivedAt).toBeNull();
  });

  it("rejects an unknown status, the archived alias and a bad position", async () => {
    const { member, task } = await createFixture();
    mockAuthenticatedSession(member.user);

    for (const body of [
      { status: "no-such-column", position: 1 },
      { status: "archived", position: 1 },
      { position: -1 },
      { position: 1.5 },
      { status: "done" },
    ]) {
      expect((await put(task.id, body)).status).toBe(400);
    }
    expect(await storedTask(task.id)).toMatchObject({
      status: "to-do",
      position: 1,
      archivedAt: null,
    });
  });

  it("requires task:update", async () => {
    const { member, task } = await createFixture("viewer");
    mockAuthenticatedSession(member.user);

    expect((await put(task.id, { position: 9 })).status).toBe(403);
    expect((await storedTask(task.id))?.position).toBe(1);
  });

  it("keeps a task out of another workspace's reach", async () => {
    const { task } = await createFixture();
    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);

    const response = await put(task.id, { position: 9 });
    expect([403, 404]).toContain(response.status);
    expect((await storedTask(task.id))?.position).toBe(1);
  });

  it("still accepts the full update for existing API clients", async () => {
    const { member, task, project } = await createFixture();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Full update",
        status: "done",
        priority: "high",
        projectId: project.id,
        position: 3,
        userId: "",
      }),
    });

    expect(response.status).toBe(200);
    expect(await storedTask(task.id)).toMatchObject({
      title: "Full update",
      status: "done",
      position: 3,
    });
  });
});
