import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { cycleContext, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const m = vi.hoisted(() => ({
  events: [] as { type: string; data: Record<string, unknown> }[],
}));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: vi.fn(async (type: string, data: Record<string, unknown>) => {
    m.events.push({ type, data });
  }),
}));

beforeEach(async () => {
  await resetTestDatabase();
  m.events.length = 0;
  vi.clearAllMocks();
});

async function scene(role = "member") {
  const { user, workspace } = await createWorkspaceMember({ role });
  const source = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Source",
    slug: "source",
  });
  const destination = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Destination",
    slug: "destination",
  });
  mockAuthenticatedSession(user);
  return { user, workspace, source, destination, app: createApp().app };
}

type Scene = Awaited<ReturnType<typeof scene>>;

async function seedTask(
  projectId: string,
  overrides: Partial<typeof schema.taskTable.$inferInsert> & { number: number },
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title: `Task ${overrides.number}`, ...overrides })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  return task;
}

function bulkMove(
  app: Scene["app"],
  taskIds: string[],
  value: string | null | undefined,
  headers: Record<string, string> = {},
) {
  return app.request("/api/task/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ taskIds, operation: "move", value }),
  });
}

async function projectOf(taskId: string) {
  const task = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, taskId),
  });
  return task?.projectId;
}

async function firstColumnOf(projectId: string) {
  const [column] = await db
    .select()
    .from(schema.columnTable)
    .where(
      and(
        eq(schema.columnTable.projectId, projectId),
        ne(schema.columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(schema.columnTable.position))
    .limit(1);
  if (!column) throw new Error("Project has no columns");
  return column;
}

describe("bulk move: what happens to each task", () => {
  it("gives every task a new key and keeps their order", async () => {
    const s = await scene();
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 40 })
      .where(eq(schema.projectTable.id, s.destination.project.id));
    await seedTask(s.destination.project.id, {
      number: 40,
      status: "to-do",
      columnId: s.destination.columns.todo.id,
      position: 7,
    });
    const second = await seedTask(s.source.project.id, {
      number: 1,
      status: "to-do",
      columnId: s.source.columns.todo.id,
      position: 2,
    });
    const first = await seedTask(s.source.project.id, {
      number: 2,
      status: "to-do",
      columnId: s.source.columns.todo.id,
      position: 1,
    });

    const response = await bulkMove(
      s.app,
      [second.id, first.id],
      s.destination.project.id,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, updatedCount: 2 });

    const moved = await db
      .select()
      .from(schema.taskTable)
      .where(inArray(schema.taskTable.id, [first.id, second.id]));
    const byId = new Map(moved.map((task) => [task.id, task]));
    expect(byId.get(first.id)).toMatchObject({
      projectId: s.destination.project.id,
      columnId: s.destination.columns.todo.id,
      status: "to-do",
      number: 41,
      position: 8,
    });
    expect(byId.get(second.id)).toMatchObject({
      projectId: s.destination.project.id,
      number: 42,
      position: 9,
    });
    for (const task of [first, second]) {
      expect(m.events).toContainEqual({
        type: "task.moved",
        data: expect.objectContaining({
          taskId: task.id,
          type: "moved",
          userId: s.user.id,
          fromProjectId: s.source.project.id,
          fromProjectName: "Source",
          toProjectId: s.destination.project.id,
          toProjectName: "Destination",
          oldStatus: "to-do",
          newStatus: "to-do",
        }),
      });
    }
  });

  it("maps a status the destination lacks to its first column", async () => {
    const s = await scene();
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.id, s.destination.columns.inReview.id));
    const known = await seedTask(s.source.project.id, {
      number: 1,
      status: "done",
      columnId: s.source.columns.done.id,
    });
    const unknown = await seedTask(s.source.project.id, {
      number: 2,
      status: "in-review",
      columnId: s.source.columns.inReview.id,
    });

    const response = await bulkMove(
      s.app,
      [known.id, unknown.id],
      s.destination.project.id,
    );
    expect(response.status).toBe(200);

    const first = await firstColumnOf(s.destination.project.id);
    const movedUnknown = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, unknown.id),
    });
    expect(movedUnknown).toMatchObject({
      status: first.slug,
      columnId: first.id,
    });
    const movedKnown = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, known.id),
    });
    expect(movedKnown).toMatchObject({
      status: "done",
      columnId: s.destination.columns.done.id,
    });
    expect(movedKnown?.completedAt).not.toBeNull();
  });

  it("keeps labels and assignees, and drops labels of another workspace", async () => {
    const s = await scene();
    const elsewhere = await createWorkspaceMember();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await assignTask(task.id, [s.user.id]);
    await db.insert(schema.labelTable).values([
      {
        name: "Keep",
        color: "red",
        taskId: task.id,
        workspaceId: s.workspace.id,
      },
      {
        name: "Foreign",
        color: "blue",
        taskId: task.id,
        workspaceId: elsewhere.workspace.id,
      },
    ]);

    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(200);

    const labels = await db
      .select({ name: schema.labelTable.name })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, task.id));
    expect(labels).toEqual([{ name: "Keep" }]);
    expect(
      await db
        .select({ userId: schema.taskAssigneeTable.userId })
        .from(schema.taskAssigneeTable)
        .where(eq(schema.taskAssigneeTable.taskId, task.id)),
    ).toEqual([{ userId: s.user.id }]);
    expect(m.events).toContainEqual({
      type: "task.label_unassigned",
      data: expect.objectContaining({
        taskId: task.id,
        projectId: s.destination.project.id,
        label: expect.objectContaining({ name: "Foreign" }),
      }),
    });
  });

  it("carries custom field values to a same-named field of the same type, and removes the rest", async () => {
    const s = await scene();
    const field = async (
      projectId: string,
      name: string,
      type: string,
      options?: string[],
    ) => {
      const [row] = await db
        .insert(schema.customFieldDefinitionTable)
        .values({ projectId, name, type, options })
        .returning();
      if (!row) throw new Error("Failed to seed field");
      return row;
    };
    const sourceId = s.source.project.id;
    const destinationId = s.destination.project.id;
    const sameSource = await field(sourceId, "Customer", "text");
    const sameTarget = await field(destinationId, " customer ", "text");
    const wrongType = await field(sourceId, "Budget", "text");
    await field(destinationId, "Budget", "number");
    const onlySource = await field(sourceId, "Only here", "text");
    const badOption = await field(sourceId, "Size", "dropdown", ["XL"]);
    await field(destinationId, "Size", "dropdown", ["S", "M"]);
    const goodOption = await field(sourceId, "Tier", "dropdown", ["Gold"]);
    const tierTarget = await field(destinationId, "Tier", "dropdown", ["Gold"]);

    const task = await seedTask(sourceId, { number: 1 });
    await db.insert(schema.customFieldValueTable).values(
      [
        [sameSource.id, "Acme"],
        [wrongType.id, "lots"],
        [onlySource.id, "gone"],
        [badOption.id, "XL"],
        [goodOption.id, "Gold"],
      ].map(([fieldId, value]) => ({
        taskId: task.id,
        fieldId: fieldId as string,
        value,
      })),
    );

    const response = await bulkMove(s.app, [task.id], destinationId);
    expect(response.status).toBe(200);

    const values = await db
      .select({
        fieldId: schema.customFieldValueTable.fieldId,
        value: schema.customFieldValueTable.value,
      })
      .from(schema.customFieldValueTable)
      .where(eq(schema.customFieldValueTable.taskId, task.id));
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        { fieldId: sameTarget.id, value: "Acme" },
        { fieldId: tierTarget.id, value: "Gold" },
      ]),
    );
  });

  it("applies the custom field rule to a single-task move too", async () => {
    const s = await scene();
    const [source] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({ projectId: s.source.project.id, name: "Team", type: "text" })
      .returning();
    const [target] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: s.destination.project.id,
        name: "Team",
        type: "text",
      })
      .returning();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await db.insert(schema.customFieldValueTable).values({
      taskId: task.id,
      fieldId: source?.id as string,
      value: "Core",
    });

    const response = await s.app.request(
      `/api/task/move/${task.id}`,
      json("PUT", { destinationProjectId: s.destination.project.id }),
    );
    expect(response.status).toBe(200);
    expect(
      await db
        .select({
          fieldId: schema.customFieldValueTable.fieldId,
          value: schema.customFieldValueTable.value,
        })
        .from(schema.customFieldValueTable)
        .where(eq(schema.customFieldValueTable.taskId, task.id)),
    ).toEqual([{ fieldId: target?.id, value: "Core" }]);
  });

  it("takes the tasks out of their cycle", async () => {
    const ctx = await cycleContext();
    const cycle = await ctx.createCycle({ name: "Sprint" });
    const task = await ctx.createTask();
    await ctx.app.request(
      `/api/cycle/${cycle.id}/tasks`,
      json("POST", { taskIds: [task.id] }),
    );
    const destination = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "dest",
    });

    const response = await bulkMove(ctx.app, [task.id], destination.project.id);
    expect(response.status).toBe(200);
    expect(await ctx.membership(task.id)).toBeNull();
    expect(m.events).toContainEqual({
      type: "task.cycle_changed",
      data: expect.objectContaining({
        taskId: task.id,
        projectId: ctx.project.id,
        newCycleId: null,
      }),
    });
  });

  it("skips tasks already in the destination", async () => {
    const s = await scene();
    const here = await seedTask(s.destination.project.id, { number: 5 });
    const there = await seedTask(s.source.project.id, { number: 6 });

    const mixed = await bulkMove(
      s.app,
      [here.id, there.id],
      s.destination.project.id,
    );
    expect(await mixed.json()).toMatchObject({ updatedCount: 1 });
    const unchanged = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, here.id),
    });
    expect(unchanged?.number).toBe(5);

    const none = await bulkMove(s.app, [here.id], s.destination.project.id);
    expect(none.status).toBe(200);
    expect(await none.json()).toMatchObject({ updatedCount: 0 });
  });

  it("refuses the whole selection when a task waits in intake", async () => {
    const s = await scene();
    const [triage] = await db
      .insert(schema.columnTable)
      .values({
        projectId: s.source.project.id,
        name: "Triage",
        slug: "triage",
        position: 99,
        group: "triage",
      })
      .returning();
    const waiting = await seedTask(s.source.project.id, {
      number: 1,
      status: "triage",
      columnId: triage?.id,
    });
    const ordinary = await seedTask(s.source.project.id, { number: 2 });

    const response = await bulkMove(
      s.app,
      [waiting.id, ordinary.id],
      s.destination.project.id,
    );
    expect(response.status).toBe(409);
    expect(await projectOf(ordinary.id)).toBe(s.source.project.id);
  });
});

describe("bulk move: permissions on both ends", () => {
  async function restrict(projectId: string) {
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, projectId));
  }

  async function addProjectMember(
    projectId: string,
    userId: string,
    role: string,
  ) {
    await db.insert(projectMemberTable).values({ projectId, userId, role });
  }

  it("refuses a workspace viewer", async () => {
    const s = await scene("viewer");
    const task = await seedTask(s.source.project.id, { number: 1 });
    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("hides a restricted destination the caller is not in", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrict(s.destination.project.id);
    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(404);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("applies the project role of the destination", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrict(s.destination.project.id);
    await addProjectMember(s.destination.project.id, s.user.id, "viewer");
    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("applies the project role of the source", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrict(s.source.project.id);
    await addProjectMember(s.source.project.id, s.user.id, "viewer");
    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("moves into a restricted project where the caller may edit", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrict(s.destination.project.id);
    await addProjectMember(s.destination.project.id, s.user.id, "member");
    const response = await bulkMove(s.app, [task.id], s.destination.project.id);
    expect(response.status).toBe(200);
    expect(await projectOf(task.id)).toBe(s.destination.project.id);
  });

  it("refuses another workspace's project and a trashed one, identically", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    const foreign = await createWorkspaceMember();
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.destination.project.id));

    for (const destination of [
      foreignProject.project.id,
      s.destination.project.id,
      "missing-project",
    ]) {
      const response = await bulkMove(s.app, [task.id], destination);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Project not found");
    }
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("keeps a project-limited API key inside its projects", async () => {
    const s = await scene("admin");
    const task = await seedTask(s.source.project.id, { number: 1 });
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.source.project.id] }) ??
        undefined,
    );
    const response = await bulkMove(
      s.app,
      [task.id],
      s.destination.project.id,
      key.headers,
    );
    expect(response.status).toBe(404);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("needs a destination", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    for (const value of [null, undefined, ""]) {
      const response = await bulkMove(s.app, [task.id], value);
      expect(response.status).toBe(400);
    }
  });
});

// The single-task routes act on the destination just like the bulk move.
describe("single move and copy: permissions on the destination", () => {
  const send = (
    app: Scene["app"],
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const move = (
    app: Scene["app"],
    taskId: string,
    destinationProjectId: string,
    headers?: Record<string, string>,
  ) =>
    send(
      app,
      "PUT",
      `/api/task/move/${taskId}`,
      { destinationProjectId },
      headers,
    );
  const copy = (
    app: Scene["app"],
    taskId: string,
    projectId: string | undefined,
    headers?: Record<string, string>,
  ) => send(app, "POST", `/api/task-copy/${taskId}`, { projectId }, headers);

  async function restrictWithRole(
    projectId: string,
    userId: string,
    role: string,
  ) {
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, projectId));
    await db.insert(projectMemberTable).values({ projectId, userId, role });
  }

  const tasksIn = (projectId: string) =>
    db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, projectId));

  it("refuses a move into a project where the caller's role only reads", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrictWithRole(s.destination.project.id, s.user.id, "viewer");
    const response = await move(s.app, task.id, s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("keeps the source's project role when the destination allows the move", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrictWithRole(s.source.project.id, s.user.id, "viewer");
    const response = await move(s.app, task.id, s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("moves into a restricted project where the caller may edit", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrictWithRole(s.destination.project.id, s.user.id, "member");
    const response = await move(s.app, task.id, s.destination.project.id);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await projectOf(task.id)).toBe(s.destination.project.id);
  });

  it("refuses a copy into a project where the caller's role only reads", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrictWithRole(s.destination.project.id, s.user.id, "viewer");
    const response = await copy(s.app, task.id, s.destination.project.id);
    expect(response.status).toBe(403);
    expect(await tasksIn(s.destination.project.id)).toHaveLength(0);
  });

  it("copies into a restricted project where the caller may create", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    await restrictWithRole(s.destination.project.id, s.user.id, "member");
    const response = await copy(s.app, task.id, s.destination.project.id);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await tasksIn(s.destination.project.id)).toHaveLength(1);
  });

  it("still copies inside the task's own project with no destination named", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 500 });
    const response = await copy(s.app, task.id, undefined);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await tasksIn(s.source.project.id)).toHaveLength(2);
  });

  it("keeps a project-limited API key inside its projects", async () => {
    const s = await scene("admin");
    const task = await seedTask(s.source.project.id, { number: 500 });
    const key = await createApiKey(
      s.user,
      encodeScope({ access: "full", projectIds: [s.source.project.id] }) ??
        undefined,
    );
    const moved = await move(
      s.app,
      task.id,
      s.destination.project.id,
      key.headers,
    );
    expect(moved.status).toBe(404);
    expect(await projectOf(task.id)).toBe(s.source.project.id);

    const copied = await copy(
      s.app,
      task.id,
      s.destination.project.id,
      key.headers,
    );
    expect(copied.status).toBe(404);
    expect(await tasksIn(s.destination.project.id)).toHaveLength(0);

    // Inside its project the key still copies.
    const inside = await copy(s.app, task.id, undefined, key.headers);
    expect(inside.status, await inside.clone().text()).toBe(200);
  });

  it("refuses another workspace's project and a trashed one, identically", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    const foreign = await createWorkspaceMember();
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.destination.project.id));

    for (const destination of [
      foreignProject.project.id,
      s.destination.project.id,
      "missing-project",
    ]) {
      const moved = await move(s.app, task.id, destination);
      expect(moved.status).toBe(404);
      expect(await moved.text()).toBe("Project not found");
      const copied = await copy(s.app, task.id, destination);
      expect(copied.status).toBe(404);
      expect(await copied.text()).toBe("Project not found");
    }
    expect(await projectOf(task.id)).toBe(s.source.project.id);
  });

  it("leaves a malformed destination to the validator", async () => {
    const s = await scene();
    const task = await seedTask(s.source.project.id, { number: 1 });
    const moved = await send(s.app, "PUT", `/api/task/move/${task.id}`, {
      destinationProjectId: ["not", "a", "string"],
    });
    expect(moved.status).toBe(400);
    const missing = await send(s.app, "PUT", `/api/task/move/${task.id}`, {});
    expect(missing.status).toBe(400);
  });
});
