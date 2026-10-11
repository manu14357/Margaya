import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import {
  type CycleTaskChangeJson,
  cycleContext,
  day,
  json,
} from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of ["cycle.tasks_changed", "task.cycle_changed"]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    events.push({ type, data });
  });
}

async function cycleActivities(taskId: string) {
  const rows = await db
    .select()
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.taskId, taskId),
        eq(schema.activityTable.type, "cycle_changed"),
      ),
    )
    .orderBy(schema.activityTable.createdAt);
  return rows.map((row) => row.eventData);
}

describe("API integration: cycle membership", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("adds, moves and reports unchanged and ignored ids", async () => {
    const ctx = await cycleContext();
    const { app, createCycle, createTask, insertCycle, addToCycle } = ctx;
    const target = await createCycle({ name: "Target" });
    const finished = await insertCycle({
      name: "Finished",
      startDate: day(-10),
      endDate: day(-2),
    });
    const fresh = await createTask();
    const fromFinished = await createTask();
    const already = await createTask();
    const archived = await createTask({ archivedAt: new Date() });
    await addToCycle(finished.id, [fromFinished.id]);
    await addToCycle(target.id, [already.id]);

    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "other",
    });
    const [foreign] = await db
      .insert(schema.taskTable)
      .values({ projectId: other.project.id, title: "Elsewhere", number: 1 })
      .returning();
    const [triageColumn] = await db
      .insert(schema.columnTable)
      .values({
        projectId: ctx.project.id,
        name: "Triage",
        slug: "triage",
        group: "triage",
        position: 99,
      })
      .returning();
    const triaged = await createTask({
      status: "triage",
      columnId: triageColumn?.id,
    });

    const response = await app.request(
      `/api/cycle/${target.id}/tasks`,
      json("POST", {
        taskIds: [
          fresh.id,
          fromFinished.id,
          already.id,
          archived.id,
          foreign?.id,
          triaged.id,
          "unknown-task",
          fresh.id,
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cycleId: target.id,
      added: [fresh.id],
      moved: [{ taskId: fromFinished.id, fromCycleId: finished.id }],
      removed: [],
      unchanged: [already.id],
      ignored: [archived.id, foreign?.id, triaged.id, "unknown-task"],
    });

    expect(await ctx.membership(fresh.id)).toBe(target.id);
    expect(await ctx.membership(fromFinished.id)).toBe(target.id);
    expect(await ctx.membership(archived.id)).toBeNull();

    expect(await cycleActivities(fresh.id)).toEqual([
      {
        oldCycleId: null,
        oldCycleName: null,
        newCycleId: target.id,
        newCycleName: "Target",
      },
    ]);
    expect(await cycleActivities(fromFinished.id)).toEqual([
      {
        oldCycleId: finished.id,
        oldCycleName: "Finished",
        newCycleId: target.id,
        newCycleName: "Target",
      },
    ]);
    expect(await cycleActivities(already.id)).toEqual([]);

    expect(events).toContainEqual({
      type: "cycle.tasks_changed",
      data: expect.objectContaining({
        projectId: ctx.project.id,
        userId: ctx.user.id,
        cycleIds: expect.arrayContaining([target.id, finished.id]),
        taskIds: [fresh.id, fromFinished.id],
      }),
    });
    expect(
      events.filter((event) => event.type === "task.cycle_changed"),
    ).toHaveLength(2);
  });

  it("refuses completed and archived targets", async () => {
    const { app, insertCycle, createTask } = await cycleContext();
    const task = await createTask();
    const completed = await insertCycle({
      startDate: day(-5),
      endDate: day(-1),
    });
    const archived = await insertCycle({
      startDate: day(-15),
      endDate: day(-10),
      archivedAt: new Date(),
    });

    const toCompleted = await app.request(
      `/api/cycle/${completed.id}/tasks`,
      json("POST", { taskIds: [task.id] }),
    );
    expect(toCompleted.status).toBe(409);
    expect(await toCompleted.text()).toBe(
      "Completed cycles can't receive tasks",
    );

    const toArchived = await app.request(
      `/api/cycle/${archived.id}/tasks`,
      json("POST", { taskIds: [task.id] }),
    );
    expect(toArchived.status).toBe(409);
    expect(await toArchived.text()).toBe("Archived cycles can't receive tasks");
  });

  it("bounds the id list to 1-200", async () => {
    const { app, createCycle } = await cycleContext();
    const cycle = await createCycle({ name: "A" });
    const tooMany = await app.request(
      `/api/cycle/${cycle.id}/tasks`,
      json("POST", {
        taskIds: Array.from({ length: 201 }, (_, i) => `task-${i}`),
      }),
    );
    expect(tooMany.status).toBe(400);
    const none = await app.request(
      `/api/cycle/${cycle.id}/tasks`,
      json("POST", { taskIds: [] }),
    );
    expect(none.status).toBe(400);
  });

  it("removes tasks from any cycle, completed and archived included", async () => {
    const ctx = await cycleContext();
    const { app, insertCycle, createTask, addToCycle } = ctx;
    const completed = await insertCycle({
      name: "Completed",
      startDate: day(-5),
      endDate: day(-1),
    });
    const archived = await insertCycle({
      name: "Archived",
      startDate: day(-15),
      endDate: day(-10),
      archivedAt: new Date(),
    });
    const a = await createTask();
    const b = await createTask();
    const outside = await createTask();
    await addToCycle(completed.id, [a.id]);
    await addToCycle(archived.id, [b.id]);

    const fromCompleted = await app.request(
      `/api/cycle/${completed.id}/tasks`,
      json("DELETE", { taskIds: [a.id, outside.id, "unknown-task"] }),
    );
    expect(fromCompleted.status).toBe(200);
    expect((await fromCompleted.json()) as CycleTaskChangeJson).toMatchObject({
      removed: [a.id],
      unchanged: [outside.id],
      ignored: ["unknown-task"],
    });

    const fromArchived = await app.request(
      `/api/cycle/${archived.id}/tasks`,
      json("DELETE", { taskIds: [b.id] }),
    );
    expect(fromArchived.status).toBe(200);
    expect(await ctx.membership(a.id)).toBeNull();
    expect(await ctx.membership(b.id)).toBeNull();
    expect(await cycleActivities(b.id)).toEqual([
      {
        oldCycleId: archived.id,
        oldCycleName: "Archived",
        newCycleId: null,
        newCycleName: null,
      },
    ]);
  });

  describe("PUT /cycle/task/{taskId}", () => {
    it("sets, moves and clears a task's cycle", async () => {
      const ctx = await cycleContext();
      const { app, createCycle, createTask } = ctx;
      const first = await createCycle({ name: "First" });
      const second = await createCycle({ name: "Second" });
      const task = await createTask();
      const put = (cycleId: string | null) =>
        app.request(`/api/cycle/task/${task.id}`, json("PUT", { cycleId }));

      const set = await put(first.id);
      expect(set.status).toBe(200);
      expect(await set.json()).toEqual({
        taskId: task.id,
        cycleId: first.id,
        previousCycleId: null,
      });

      const same = await put(first.id);
      expect(await same.json()).toEqual({
        taskId: task.id,
        cycleId: first.id,
        previousCycleId: first.id,
      });

      const moved = await put(second.id);
      expect(await moved.json()).toEqual({
        taskId: task.id,
        cycleId: second.id,
        previousCycleId: first.id,
      });

      const cleared = await put(null);
      expect(await cleared.json()).toEqual({
        taskId: task.id,
        cycleId: null,
        previousCycleId: second.id,
      });
      const noop = await put(null);
      expect(await noop.json()).toEqual({
        taskId: task.id,
        cycleId: null,
        previousCycleId: null,
      });

      expect(await ctx.membership(task.id)).toBeNull();
      expect(await cycleActivities(task.id)).toEqual([
        {
          oldCycleId: null,
          oldCycleName: null,
          newCycleId: first.id,
          newCycleName: "First",
        },
        {
          oldCycleId: first.id,
          oldCycleName: "First",
          newCycleId: second.id,
          newCycleName: "Second",
        },
        {
          oldCycleId: second.id,
          oldCycleName: "Second",
          newCycleId: null,
          newCycleName: null,
        },
      ]);
    });

    it("validates the target and the task", async () => {
      const ctx = await cycleContext();
      const { app, createTask, insertCycle, createCycle } = ctx;
      const task = await createTask();
      const archivedTask = await createTask({ archivedAt: new Date() });
      const cycle = await createCycle({ name: "Open" });
      const completed = await insertCycle({
        startDate: day(-5),
        endDate: day(-1),
      });

      const other = await createProjectFixture({
        workspaceId: ctx.workspace.id,
        slug: "other",
      });
      const [otherCycle] = await db
        .insert(schema.cycleTable)
        .values({ projectId: other.project.id, name: "Other project" })
        .returning();

      const stranger = await createWorkspaceMember();
      const strangerProject = await createProjectFixture({
        workspaceId: stranger.workspace.id,
        slug: "stranger",
      });
      const [foreignCycle] = await db
        .insert(schema.cycleTable)
        .values({ projectId: strangerProject.project.id, name: "Foreign" })
        .returning();

      const put = (taskId: string, cycleId: string | null) =>
        app.request(`/api/cycle/task/${taskId}`, json("PUT", { cycleId }));

      const wrongProject = await put(task.id, otherCycle?.id ?? "");
      expect(wrongProject.status).toBe(400);
      expect(await wrongProject.text()).toBe(
        "Cycle belongs to another project",
      );

      const foreign = await put(task.id, foreignCycle?.id ?? "");
      expect(foreign.status).toBe(404);

      const unknown = await put(task.id, "unknown-cycle");
      expect(unknown.status).toBe(404);
      expect(await unknown.text()).toBe("Cycle not found");

      const toCompleted = await put(task.id, completed.id);
      expect(toCompleted.status).toBe(409);

      const archived = await put(archivedTask.id, cycle.id);
      expect(archived.status).toBe(409);
      expect(await archived.text()).toBe("Archived tasks can't be planned");

      // Leaving is always allowed, even for archived tasks.
      await ctx.addToCycle(completed.id, [archivedTask.id]);
      const leave = await put(archivedTask.id, null);
      expect(leave.status).toBe(200);
      expect(await ctx.membership(archivedTask.id)).toBeNull();

      const missingTask = await app.request(
        `/api/cycle/task/unknown-task?workspaceId=${ctx.workspace.id}`,
        json("PUT", { cycleId: null }),
      );
      expect(missingTask.status).toBe(404);
    });
  });

  it("keeps membership while a task is in the trash and cascades on a permanent delete", async () => {
    const ctx = await cycleContext("admin");
    const cycle = await ctx.createCycle({ name: "A" });
    const task = await ctx.createTask();
    await ctx.addToCycle(cycle.id, [task.id]);

    const response = await ctx.app.request(`/api/task/${task.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.cycleTaskTable)
        .where(eq(schema.cycleTaskTable.cycleId, cycle.id)),
    ).toHaveLength(1);

    const purged = await ctx.app.request(`/api/trash/task/${task.id}`, {
      method: "DELETE",
    });
    expect(purged.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.cycleTaskTable)
        .where(eq(schema.cycleTaskTable.cycleId, cycle.id)),
    ).toEqual([]);
  });

  it("takes a task out of its cycle when it moves to another project", async () => {
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
    events.length = 0;

    const response = await ctx.app.request(
      `/api/task/move/${task.id}`,
      json("PUT", { destinationProjectId: destination.project.id }),
    );
    expect(response.status).toBe(200);
    expect(await ctx.membership(task.id)).toBeNull();
    expect((await cycleActivities(task.id)).at(-1)).toEqual({
      oldCycleId: cycle.id,
      oldCycleName: "Sprint",
      newCycleId: null,
      newCycleName: null,
    });
    expect(events).toContainEqual({
      type: "task.cycle_changed",
      data: expect.objectContaining({
        taskId: task.id,
        projectId: ctx.project.id,
        oldCycleId: cycle.id,
        newCycleId: null,
      }),
    });
  });

  it("returns cycleId on the board and the task detail", async () => {
    const ctx = await cycleContext("owner");
    const cycle = await ctx.createCycle({ name: "Sprint" });
    const planned = await ctx.createTask({ status: "planned" });
    const inColumn = await ctx.createTask();
    const loose = await ctx.createTask();
    await ctx.addToCycle(cycle.id, [planned.id, inColumn.id]);

    type Board = {
      data: {
        columns: Array<{
          tasks: Array<{ id: string; cycleId: string | null }>;
        }>;
        plannedTasks: Array<{ id: string; cycleId: string | null }>;
      };
    };
    const boardCycleIds = async () => {
      const response = await ctx.app.request(
        `/api/task/tasks/${ctx.project.id}`,
      );
      expect(response.status).toBe(200);
      const board = (await response.json()) as Board;
      const tasks = [
        ...board.data.plannedTasks,
        ...board.data.columns.flatMap((column) => column.tasks),
      ];
      return Object.fromEntries(tasks.map((task) => [task.id, task.cycleId]));
    };

    expect(await boardCycleIds()).toEqual({
      [planned.id]: cycle.id,
      [inColumn.id]: cycle.id,
      [loose.id]: null,
    });
    const detail = await ctx.app.request(`/api/task/${inColumn.id}`);
    expect(await detail.json()).toMatchObject({ cycleId: cycle.id });
    const looseDetail = await ctx.app.request(`/api/task/${loose.id}`);
    expect(await looseDetail.json()).toMatchObject({ cycleId: null });

    // With the feature off, tasks read as in no cycle; memberships stay.
    await ctx.app.request(
      `/api/project/${ctx.project.id}/features`,
      json("PATCH", { cyclesEnabled: false }),
    );
    expect(Object.values(await boardCycleIds())).toEqual([null, null, null]);
    const hidden = await ctx.app.request(`/api/task/${inColumn.id}`);
    expect(await hidden.json()).toMatchObject({ cycleId: null });
    expect(await ctx.membership(inColumn.id)).toBe(cycle.id);
  });
});
