import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveTasks } from "../../apps/api/src/entity-reference/resolvers/task";
import { migrateTaskArchive } from "../../apps/api/src/migrations/task-archive-migration";
import { resetTestDatabase } from "./helpers/database";
import { activityRows, settledActivity } from "./helpers/task-detail";
import { json, queryScene } from "./helpers/task-query";

type TaskJson = {
  id: string;
  status: string;
  columnId: string | null;
  archivedAt: string | null;
  completedAt: string | null;
  createdBy?: string | null;
  position: number | null;
};

async function stored(taskId: string) {
  const [task] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  if (!task) throw new Error("task");
  return task;
}

async function scene() {
  const s = await queryScene();
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await s.app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );
    return response;
  };
  const ok = async <T>(method: string, path: string, body?: unknown) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as T;
  };
  return { ...s, call, ok };
}

describe("API integration: archiving keeps the column (D7)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("archives in place and restores through the archive routes", async () => {
    const s = await scene();
    const task = await s.createTask({ status: "in-progress", position: 7 });

    const archived = await s.ok<TaskJson>("POST", `/task/archive/${task.id}`);
    expect(archived).toMatchObject({
      status: "in-progress",
      columnId: s.columns.inProgress.id,
      position: 7,
    });
    expect(archived.archivedAt).not.toBeNull();
    const again = await s.ok<TaskJson>("POST", `/task/archive/${task.id}`);
    expect(again.archivedAt).toBe(archived.archivedAt);
    await settledActivity(task.id, "archived");

    const restored = await s.ok<TaskJson>("POST", `/task/unarchive/${task.id}`);
    expect(restored).toMatchObject({
      status: "in-progress",
      columnId: s.columns.inProgress.id,
      position: 7,
      archivedAt: null,
    });
    await settledActivity(task.id, "unarchived");
    expect((await activityRows(task.id, "archived")).length).toBe(1);

    const viewer = await s.request({}, s.viewer);
    expect(viewer.status).toBe(200);
    const denied = await s.app.request(`/api/task/archive/${task.id}`, {
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect((await s.call("POST", "/task/archive/task-missing")).status).toBe(
      400,
    );
  });

  it("reads a status write of archived as archive in place and a real status as restore", async () => {
    const s = await scene();
    const task = await s.createTask({ status: "in-progress" });

    const archived = await s.ok<TaskJson>("PUT", `/task/status/${task.id}`, {
      status: "archived",
    });
    expect(archived.status).toBe("in-progress");
    expect(archived.archivedAt).not.toBeNull();
    await settledActivity(task.id, "archived");
    expect(await activityRows(task.id, "status_changed")).toHaveLength(0);

    const moved = await s.ok<TaskJson>("PUT", `/task/status/${task.id}`, {
      status: "done",
    });
    expect(moved).toMatchObject({ status: "done", archivedAt: null });
    expect(moved.completedAt).not.toBeNull();
    await settledActivity(task.id, "unarchived");
    await settledActivity(task.id, "status_changed");
  });

  it("keeps an archived task archived when a full update echoes its status", async () => {
    const s = await scene();
    const task = await s.createTask({
      status: "to-do",
      archivedAt: new Date(),
    });
    const body = (status: string, title = "Renamed") => ({
      title,
      description: "",
      status,
      priority: "low",
      projectId: s.project.id,
      position: 1,
    });

    const echoed = await s.ok<TaskJson>(
      "PUT",
      `/task/${task.id}`,
      body("to-do"),
    );
    expect(echoed.status).toBe("to-do");
    expect(echoed.archivedAt).not.toBeNull();

    const moved = await s.ok<TaskJson>(
      "PUT",
      `/task/${task.id}`,
      body("in-progress"),
    );
    expect(moved).toMatchObject({ status: "in-progress", archivedAt: null });

    const alias = await s.ok<TaskJson>(
      "PUT",
      `/task/${task.id}`,
      body("archived"),
    );
    expect(alias.status).toBe("in-progress");
    expect(alias.archivedAt).not.toBeNull();
  });

  it("archives and restores in bulk; updateStatus archived is an alias", async () => {
    const s = await scene();
    const first = await s.createTask({ status: "to-do" });
    const second = await s.createTask({ status: "in-progress" });
    const bulk = (operation: string, value?: string) =>
      s.ok<{ updatedCount: number }>("PATCH", "/task/bulk", {
        taskIds: [first.id, second.id],
        operation,
        ...(value === undefined ? {} : { value }),
      });

    expect((await bulk("archive")).updatedCount).toBe(2);
    expect((await bulk("archive")).updatedCount).toBe(0);
    expect((await stored(second.id)).status).toBe("in-progress");
    expect((await bulk("unarchive")).updatedCount).toBe(2);

    expect((await bulk("updateStatus", "archived")).updatedCount).toBe(2);
    expect(await stored(first.id)).toMatchObject({ status: "to-do" });
    expect((await stored(first.id)).archivedAt).not.toBeNull();

    await bulk("updateStatus", "done");
    expect(await stored(first.id)).toMatchObject({
      status: "done",
      archivedAt: null,
    });
    await settledActivity(first.id, "unarchived", 2);
  });

  it("creates and imports archived tasks from the legacy status", async () => {
    const s = await scene();
    const created = await s.ok<TaskJson>("POST", `/task/${s.project.id}`, {
      title: "Old news",
      description: "",
      priority: "low",
      status: "archived",
    });
    expect(created).toMatchObject({
      status: "to-do",
      columnId: s.columns.todo.id,
      createdBy: s.owner.id,
    });
    expect(created.archivedAt).not.toBeNull();

    const imported = await s.ok<{
      results: { tasks: { success: boolean; task: TaskJson }[] };
    }>("POST", `/task/import/${s.project.id}`, {
      tasks: [
        { title: "Shipped", status: "archived" },
        {
          title: "Parked",
          status: "in-progress",
          archivedAt: "2026-01-02T00:00:00.000Z",
        },
        { title: "Broken", status: "to-do", archivedAt: "not a date" },
      ],
    });
    const [shipped, parked, broken] = imported.results.tasks;
    expect(shipped?.task).toMatchObject({
      status: "done",
      columnId: s.columns.done.id,
      createdBy: s.owner.id,
    });
    expect(shipped?.task.archivedAt).not.toBeNull();
    expect(parked?.task).toMatchObject({ status: "in-progress" });
    expect(new Date(parked?.task.archivedAt ?? 0).toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(broken?.success).toBe(false);
  });

  it("moves archived tasks out of board columns into archivedTasks", async () => {
    const s = await scene();
    const active = await s.createTask({ status: "to-do" });
    const archivedTodo = await s.createTask({
      status: "to-do",
      archivedAt: new Date(),
    });
    const archivedPlanned = await s.createTask({
      status: "planned",
      archivedAt: new Date(),
    });
    const planned = await s.createTask({ status: "planned" });
    type Board = {
      data: {
        columns: {
          slug: string;
          tasks: { id: string; archivedAt: string | null }[];
        }[];
        archivedTasks: { id: string; status: string }[];
        plannedTasks: { id: string }[];
      };
    };
    const board = await s.ok<Board>("GET", `/task/tasks/${s.project.id}`);
    const todo = board.data.columns.find((column) => column.slug === "to-do");
    expect(todo?.tasks.map((task) => task.id)).toEqual([active.id]);
    expect(board.data.plannedTasks.map((task) => task.id)).toEqual([
      planned.id,
    ]);
    expect(
      board.data.archivedTasks.map((task) => [task.id, task.status]).sort(),
    ).toEqual(
      [
        [archivedTodo.id, "to-do"],
        [archivedPlanned.id, "planned"],
      ].sort(),
    );

    const onlyArchived = await s.ok<Board>(
      "GET",
      `/task/tasks/${s.project.id}?status=archived`,
    );
    expect(onlyArchived.data.archivedTasks).toHaveLength(2);
    expect(onlyArchived.data.columns.flatMap((column) => column.tasks)).toEqual(
      [],
    );
    const todoOnly = await s.ok<Board>(
      "GET",
      `/task/tasks/${s.project.id}?status=to-do`,
    );
    expect(
      todoOnly.data.columns.flatMap((column) =>
        column.tasks.map((task) => task.id),
      ),
    ).toEqual([active.id]);
    expect(todoOnly.data.archivedTasks).toEqual([]);
  });

  it("counts archived work in project statistics by its column group", async () => {
    const s = await scene();
    const [wontFix] = await db
      .insert(schema.columnTable)
      .values({
        projectId: s.project.id,
        name: "Won't fix",
        slug: "wont-fix",
        position: 9,
        group: "cancelled",
        isFinal: true,
      })
      .returning();
    await s.createTask({ status: "done", completedAt: new Date() });
    await s.createTask({ status: "to-do", archivedAt: new Date() });
    await s.createTask({
      status: "wont-fix",
      columnId: wontFix?.id,
      archivedAt: new Date(),
    });
    await s.createTask({
      status: "to-do",
      dueDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    await s.createTask({
      status: "in-progress",
      archivedAt: new Date(),
      dueDate: new Date("2026-06-01T00:00:00.000Z"),
    });

    type Project = {
      id: string;
      statistics: {
        completionPercentage: number;
        totalTasks: number;
        dueDate: string | null;
      };
    };
    const projects = await s.ok<Project[]>(
      "GET",
      `/project?workspaceId=${s.workspaceId}`,
    );
    const statistics = projects.find((p) => p.id === s.project.id)?.statistics;
    // Done + two archived open tasks, over five tasks minus the cancelled one.
    expect(statistics).toEqual({
      totalTasks: 5,
      completionPercentage: 75,
      dueDate: "2026-12-01T00:00:00.000Z",
    });
  });

  it("keeps archived tasks out of planning and flags them for favorites", async () => {
    const s = await scene();
    const archived = await s.createTask({
      status: "done",
      archivedAt: new Date(),
    });
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId: s.project.id, name: "Sprint" })
      .returning();
    const [feature] = await db
      .insert(schema.moduleTable)
      .values({ projectId: s.project.id, name: "Feature" })
      .returning();

    const planned = await s.call("PUT", `/cycle/task/${archived.id}`, {
      cycleId: cycle?.id,
    });
    expect(planned.status).toBe(409);
    const linked = await s.call("PUT", `/module/task/${archived.id}`, {
      addModuleIds: [feature?.id],
    });
    expect(linked.status).toBe(409);

    const resolved = await resolveTasks(
      { workspaceId: s.workspaceId, userId: s.owner.id },
      [archived.id],
    );
    expect(resolved.get(archived.id)).toMatchObject({
      isArchived: true,
      details: expect.objectContaining({ status: "done", group: "completed" }),
    });
  });

  it("keeps the archive when moving a task to another project", async () => {
    const s = await scene();
    const other = await s.createProject("api");
    const task = await s.createTask({
      status: "in-progress",
      archivedAt: new Date(),
    });
    const moved = await s.ok<{ task: TaskJson }>(
      "PUT",
      `/task/move/${task.id}`,
      {
        destinationProjectId: other.id,
      },
    );
    expect(moved.task.status).toBe("in-progress");
    expect(moved.task.archivedAt).not.toBeNull();
  });

  it("exports the real status and archivedAt", async () => {
    const s = await scene();
    await s.createTask({
      status: "done",
      archivedAt: new Date("2026-03-04T00:00:00.000Z"),
    });
    const exported = await s.ok<{
      tasks: { status: string; archivedAt: string | null }[];
    }>("GET", `/task/export/${s.project.id}`);
    expect(exported.tasks).toEqual([
      expect.objectContaining({
        status: "done",
        archivedAt: "2026-03-04T00:00:00.000Z",
      }),
    ]);
  });
});

describe("API integration: deleting a column with archived tasks (D7)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("moves archived tasks to the next column of the group and keeps them archived", async () => {
    const s = await scene();
    const archivedAt = new Date("2026-02-01T00:00:00.000Z");
    const task = await s.createTask({ status: "in-progress", archivedAt });

    await s.ok("DELETE", `/column/${s.columns.inProgress.id}`);
    expect(await stored(task.id)).toMatchObject({
      status: "in-review",
      columnId: s.columns.inReview.id,
      archivedAt,
    });

    const restored = await s.ok<TaskJson>("POST", `/task/unarchive/${task.id}`);
    expect(restored).toMatchObject({
      status: "in-review",
      columnId: s.columns.inReview.id,
      archivedAt: null,
    });
  });

  it("still refuses a column with live tasks and moves nothing", async () => {
    const s = await scene();
    const archived = await s.createTask({
      status: "in-progress",
      archivedAt: new Date(),
    });
    await s.createTask({ status: "in-progress" });

    const refused = await s.call(
      "DELETE",
      `/column/${s.columns.inProgress.id}`,
    );
    expect(refused.status).toBe(409);
    expect(await stored(archived.id)).toMatchObject({
      status: "in-progress",
      columnId: s.columns.inProgress.id,
    });
  });

  it("falls back to the entry column, then planned, following the group", async () => {
    const s = await scene();
    const done = await s.createTask({
      status: "done",
      archivedAt: new Date(),
      completedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    // The only completed column: the task lands in the entry column and,
    // no longer in a completed group, loses its completion time.
    await s.ok("DELETE", `/column/${s.columns.done.id}`);
    expect(await stored(done.id)).toMatchObject({
      status: "to-do",
      columnId: s.columns.todo.id,
      completedAt: null,
    });
    expect((await stored(done.id)).archivedAt).not.toBeNull();

    await db
      .delete(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, s.project.id),
          eq(schema.columnTable.group, "started"),
        ),
      );
    await s.ok("DELETE", `/column/${s.columns.todo.id}`);
    expect(await stored(done.id)).toMatchObject({
      status: "planned",
      columnId: null,
    });
  });
});

describe("API integration: archive boot migration (D7)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const OLD = new Date("2021-03-04T05:06:07.000Z");

  it("restores each archived task's column from its history, once", async () => {
    const s = await queryScene();
    const legacy = async (projectId = s.project.id, extra = {}) =>
      s.createTask({
        projectId,
        status: "archived",
        columnId: null,
        updatedAt: OLD,
        ...extra,
      });
    // Explicit instants: the database clock may drift from the test host
    // clock, which would reorder a default now() against Date.now().
    const history = async (taskId: string, oldStatus: string) => {
      await db.insert(schema.activityTable).values({
        taskId,
        type: "status_changed",
        userId: s.owner.id,
        eventData: { oldStatus, newStatus: "archived" },
        createdAt: OLD,
      });
    };

    const fromProgress = await legacy();
    await history(fromProgress.id, "to-do");
    // The latest move to archived wins.
    await db.insert(schema.activityTable).values({
      taskId: fromProgress.id,
      type: "status_changed",
      userId: s.owner.id,
      eventData: { oldStatus: "in-progress", newStatus: "archived" },
      createdAt: new Date(OLD.getTime() + 1000),
    });
    const fromPlanned = await legacy();
    await history(fromPlanned.id, "planned");
    const noHistory = await legacy();
    const goneColumn = await legacy();
    await history(goneColumn.id, "old-review");
    const earlier = new Date("2020-01-01T00:00:00.000Z");
    const alreadyStamped = await legacy(s.project.id, { archivedAt: earlier });

    const noDone = await s.createProject("nodone");
    await db
      .delete(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, noDone.id),
          eq(schema.columnTable.slug, "done"),
        ),
      );
    const toEntry = await legacy(noDone.id);
    const bare = await s.createProject("bare");
    await db
      .delete(schema.columnTable)
      .where(eq(schema.columnTable.projectId, bare.id));
    const toPlanned = await legacy(bare.id);

    expect(await migrateTaskArchive()).toMatchObject({ archived: 7 });

    const columnOf = async (projectId: string, slug: string) =>
      (
        await db
          .select({ id: schema.columnTable.id })
          .from(schema.columnTable)
          .where(
            and(
              eq(schema.columnTable.projectId, projectId),
              eq(schema.columnTable.slug, slug),
            ),
          )
      )[0]?.id ?? null;

    expect(await stored(fromProgress.id)).toMatchObject({
      status: "in-progress",
      columnId: s.columns.inProgress.id,
      archivedAt: OLD,
      updatedAt: OLD,
      completedAt: null,
    });
    expect(await stored(fromPlanned.id)).toMatchObject({
      status: "planned",
      columnId: null,
      archivedAt: OLD,
    });
    // No usable history: the first completed column, completed at archiving.
    expect(await stored(noHistory.id)).toMatchObject({
      status: "done",
      columnId: s.columns.done.id,
      archivedAt: OLD,
      completedAt: OLD,
    });
    expect(await stored(goneColumn.id)).toMatchObject({
      status: "done",
      archivedAt: OLD,
    });
    expect(await stored(alreadyStamped.id)).toMatchObject({
      status: "done",
      archivedAt: earlier,
      completedAt: earlier,
    });
    expect(await stored(toEntry.id)).toMatchObject({
      status: "to-do",
      columnId: await columnOf(noDone.id, "to-do"),
      completedAt: null,
    });
    expect(await stored(toPlanned.id)).toMatchObject({
      status: "planned",
      columnId: null,
      archivedAt: OLD,
    });

    expect(await migrateTaskArchive()).toEqual({ archived: 0, createdBy: 0 });
  });

  it("backfills creators from the created activity, once", async () => {
    const s = await queryScene();
    const created = await s.createTask({ createdBy: null });
    const imported = await s.createTask({ createdBy: null });
    const external = await s.createTask({ createdBy: null });
    const kept = await s.createTask({ createdBy: s.cara.id });
    await db.insert(schema.activityTable).values([
      { taskId: created.id, type: "created", userId: s.ben.id },
      { taskId: imported.id, type: "create", userId: s.cara.id },
      { taskId: kept.id, type: "created", userId: s.ben.id },
    ]);

    expect(await migrateTaskArchive()).toEqual({ archived: 0, createdBy: 2 });
    expect((await stored(created.id)).createdBy).toBe(s.ben.id);
    expect((await stored(imported.id)).createdBy).toBe(s.cara.id);
    expect((await stored(external.id)).createdBy).toBeNull();
    expect((await stored(kept.id)).createdBy).toBe(s.cara.id);
    expect(await migrateTaskArchive()).toEqual({ archived: 0, createdBy: 0 });
  });
});
