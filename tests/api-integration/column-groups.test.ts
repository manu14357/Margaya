import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { repairColumnGroups } from "../../apps/api/src/migrations/column-migration";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Column = typeof schema.columnTable.$inferSelect;

const columnEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of [
  "column.created",
  "column.updated",
  "column.reordered",
  "column.deleted",
]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    columnEvents.push({ type, data });
  });
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function ownerContext() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const fixture = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  return { ...owner, ...fixture, app };
}

async function seedTask(projectId: string, status: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title: `Task ${number}`, status, number })
    .returning();
  return task;
}

async function readTask(id: string) {
  const [task] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, id));
  return task;
}

async function insertTriageColumn(projectId: string) {
  const [column] = await db
    .insert(schema.columnTable)
    .values({
      projectId,
      name: "Triage",
      slug: "triage",
      position: 99,
      group: "triage",
    })
    .returning();
  return column;
}

describe("API integration: column groups", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    columnEvents.length = 0;
  });

  it("gives new projects grouped default columns", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await app.request(
      "/api/project",
      json("POST", {
        name: "Grouped",
        workspaceId: owner.workspace.id,
        icon: "Layout",
        slug: "grp",
      }),
    );
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    const response = await app.request(`/api/column/${project.id}`);
    const columns = (await response.json()) as Column[];
    expect(columns.map((column) => column.group)).toEqual([
      "unstarted",
      "started",
      "started",
      "completed",
    ]);
    expect(columns.map((column) => column.isFinal)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("resolves the group and isFinal on create", async () => {
    const { app, project } = await ownerContext();
    const create = (body: Record<string, unknown>) =>
      app.request(`/api/column/${project.id}`, json("POST", body));

    const cancelled = await create({ name: "Won't do", group: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      slug: "won-t-do",
      group: "cancelled",
      isFinal: true,
    });

    const finalOnly = await create({ name: "Shipped", isFinal: true });
    expect(await finalOnly.json()).toMatchObject({
      group: "completed",
      isFinal: true,
    });

    const plain = await create({ name: "Icebox" });
    expect(await plain.json()).toMatchObject({
      group: "unstarted",
      isFinal: false,
    });

    const mismatch = await create({
      name: "Odd",
      group: "started",
      isFinal: true,
    });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).toContain(
      "isFinal must match the column group",
    );

    const triage = await create({ name: "Inbox", group: "triage" });
    expect(triage.status).toBe(400);
    expect(await triage.text()).toContain(
      "The triage group is reserved for intake",
    );

    const unknown = await create({ name: "Nope", group: "someday" });
    expect(unknown.status).toBe(400);

    expect(
      columnEvents.filter((e) => e.type === "column.created"),
    ).toHaveLength(3);
  });

  it("keeps isFinal and completedAt in step with group changes", async () => {
    const { app, project, columns, user } = await ownerContext();
    const task = await seedTask(project.id, "in-progress", 1);

    const toCompleted = await app.request(
      `/api/column/${columns.inProgress.id}`,
      json("PUT", { group: "completed" }),
    );
    expect(toCompleted.status).toBe(200);
    expect(await toCompleted.json()).toMatchObject({
      group: "completed",
      isFinal: true,
    });
    const completed = await readTask(task.id);
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(columnEvents).toContainEqual({
      type: "column.updated",
      data: expect.objectContaining({
        projectId: project.id,
        columnId: columns.inProgress.id,
        userId: user.id,
        changed: ["group", "isFinal"],
      }),
    });

    const toCancelled = await app.request(
      `/api/column/${columns.inProgress.id}`,
      json("PUT", { group: "cancelled" }),
    );
    expect(await toCancelled.json()).toMatchObject({
      group: "cancelled",
      isFinal: true,
    });
    expect((await readTask(task.id)).completedAt).toBeNull();

    await app.request(
      `/api/column/${columns.inProgress.id}`,
      json("PUT", { group: "completed" }),
    );
    expect((await readTask(task.id)).completedAt).toBeInstanceOf(Date);

    const toStarted = await app.request(
      `/api/column/${columns.inProgress.id}`,
      json("PUT", { group: "started" }),
    );
    expect(await toStarted.json()).toMatchObject({
      group: "started",
      isFinal: false,
    });
    expect((await readTask(task.id)).completedAt).toBeNull();
  });

  it("turns a completed column into started when isFinal is cleared", async () => {
    const { app, columns } = await ownerContext();

    const response = await app.request(
      `/api/column/${columns.done.id}`,
      json("PUT", { isFinal: false }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      group: "started",
      isFinal: false,
    });
  });

  it("hides triage columns and refuses to edit or delete them", async () => {
    const { app, project } = await ownerContext();
    const triage = await insertTriageColumn(project.id);

    const defaultList = (await (
      await app.request(`/api/column/${project.id}`)
    ).json()) as Column[];
    expect(defaultList.map((column) => column.slug)).not.toContain("triage");

    const fullList = (await (
      await app.request(`/api/column/${project.id}?includeTriage=true`)
    ).json()) as Column[];
    expect(fullList.map((column) => column.slug)).toContain("triage");

    const update = await app.request(
      `/api/column/${triage.id}`,
      json("PUT", { name: "Renamed" }),
    );
    expect(update.status).toBe(400);
    expect(await update.text()).toContain(
      "Triage columns are managed by intake",
    );

    const remove = await app.request(`/api/column/${triage.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(400);
  });

  it("keeps triage columns and their tasks off the board", async () => {
    const { app, project } = await ownerContext();
    await insertTriageColumn(project.id);
    await seedTask(project.id, "triage", 1);
    await seedTask(project.id, "to-do", 2);

    const response = await app.request(`/api/task/tasks/${project.id}`);
    expect(response.status).toBe(200);
    const board = (await response.json()) as {
      data: {
        columns: Array<{ slug: string; group: string; tasks: unknown[] }>;
      };
      pagination: { total: number };
    };

    expect(board.data.columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(board.data.columns.map((column) => column.group)).toEqual([
      "unstarted",
      "started",
      "started",
      "completed",
    ]);
    expect(board.pagination.total).toBe(1);
  });

  it("refuses ordinary task writes into a triage column", async () => {
    const { app, project } = await ownerContext();
    await insertTriageColumn(project.id);
    const task = await seedTask(project.id, "to-do", 1);

    const response = await app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "triage" }),
    );

    expect(response.status).toBe(400);
  });

  it("requires project:update for every column write", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const member = await addWorkspaceMember(owner.workspace.id, "member");
    mockAuthenticatedSession(member);
    const { app } = createApp();

    const create = await app.request(
      `/api/column/${project.id}`,
      json("POST", { name: "Nope" }),
    );
    const update = await app.request(
      `/api/column/${columns.todo.id}`,
      json("PUT", { group: "backlog" }),
    );
    const reorder = await app.request(
      `/api/column/reorder/${project.id}`,
      json("PUT", { columns: [{ id: columns.todo.id, position: 3 }] }),
    );
    const remove = await app.request(`/api/column/${columns.todo.id}`, {
      method: "DELETE",
    });

    expect([create, update, reorder, remove].map((r) => r.status)).toEqual([
      403, 403, 403, 403,
    ]);
    expect(columnEvents).toHaveLength(0);
  });

  it("repairs inconsistent groups and completion times on startup", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await db
      .update(schema.columnTable)
      .set({ group: "unstarted" })
      .where(eq(schema.columnTable.id, columns.done.id));
    const [wontDo] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: "Won't do",
        slug: "wont-do",
        position: 4,
        group: "cancelled",
        isFinal: false,
      })
      .returning();
    const done = await seedTask(project.id, "done", 1);
    const stale = await seedTask(project.id, "to-do", 2);
    const archived = await seedTask(project.id, "archived", 3);
    const stamp = new Date("2026-01-01T00:00:00.000Z");
    for (const id of [stale.id, archived.id]) {
      await db
        .update(schema.taskTable)
        .set({ completedAt: stamp })
        .where(eq(schema.taskTable.id, id));
    }

    await repairColumnGroups();
    await repairColumnGroups();

    const repaired = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    const bySlug = new Map(repaired.map((column) => [column.slug, column]));
    expect(bySlug.get("done")).toMatchObject({
      group: "completed",
      isFinal: true,
    });
    expect(bySlug.get(wontDo.slug)).toMatchObject({
      group: "cancelled",
      isFinal: true,
    });

    const doneTask = await readTask(done.id);
    expect(doneTask.completedAt).toEqual(doneTask.updatedAt);
    expect((await readTask(stale.id)).completedAt).toBeNull();
    expect((await readTask(archived.id)).completedAt).toEqual(stamp);
  });

  it("publishes reorder and delete events", async () => {
    const { app, project, columns } = await ownerContext();

    await app.request(
      `/api/column/reorder/${project.id}`,
      json("PUT", {
        columns: [
          { id: columns.todo.id, position: 1 },
          { id: columns.inProgress.id, position: 0 },
        ],
      }),
    );
    const removed = await app.request(`/api/column/${columns.inReview.id}`, {
      method: "DELETE",
    });

    expect(removed.status).toBe(200);
    expect(columnEvents.map((event) => event.type)).toEqual([
      "column.reordered",
      "column.deleted",
    ]);
  });
});
