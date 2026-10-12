import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  json,
  type ModuleTaskChangeJson,
  moduleContext,
} from "./helpers/modules";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
await subscribeToEvent<Record<string, unknown>>(
  "module.tasks_changed",
  async (data) => {
    events.push({ type: "module.tasks_changed", data });
  },
);

type TaskModuleRef = { id: string; name: string; status: string };

async function moduleActivity(taskIds: string[]) {
  return db
    .select({
      taskId: schema.activityTable.taskId,
      type: schema.activityTable.type,
      eventData: schema.activityTable.eventData,
    })
    .from(schema.activityTable)
    .where(
      and(
        inArray(schema.activityTable.taskId, taskIds),
        inArray(schema.activityTable.type, ["module_added", "module_removed"]),
      ),
    );
}

describe("API integration: module membership", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("adds and removes tasks, reporting what changed per id", async () => {
    const ctx = await moduleContext();
    const { ok, request, createModule, createTask, workspace } = ctx;
    const billing = await createModule({ name: "Billing" });
    const [a, b, c] = [
      await createTask(),
      await createTask(),
      await createTask({ status: "planned" }),
    ];
    const archived = await createTask({ archivedAt: new Date() });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [foreign] = await db
      .insert(schema.taskTable)
      .values({ projectId: otherProject.id, title: "Elsewhere", number: 1 })
      .returning();
    if (!foreign) throw new Error("fixture");

    const add = (taskIds: string[]) =>
      ok<ModuleTaskChangeJson>(
        `/${billing.id}/tasks`,
        json("POST", { taskIds }),
      );
    const remove = (taskIds: string[]) =>
      ok<ModuleTaskChangeJson>(
        `/${billing.id}/tasks`,
        json("DELETE", { taskIds }),
      );

    expect(await add([a.id, b.id, c.id, a.id])).toEqual({
      moduleId: billing.id,
      added: [a.id, b.id, c.id],
      removed: [],
      unchanged: [],
      ignored: [],
    });
    expect(
      await add([a.id, foreign.id, archived.id, "missing-task"]),
    ).toMatchObject({
      added: [],
      unchanged: [a.id],
      ignored: [foreign.id, archived.id, "missing-task"],
    });
    expect(await ctx.linkedTaskIds(billing.id)).toEqual(
      [a.id, b.id, c.id].sort(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      moduleId: billing.id,
      moduleName: "Billing",
      added: [a.id, b.id, c.id],
      removed: [],
    });

    expect(await remove([a.id, b.id])).toMatchObject({
      removed: [a.id, b.id],
      unchanged: [],
    });
    expect(await remove([a.id, foreign.id])).toMatchObject({
      removed: [],
      unchanged: [a.id],
      ignored: [foreign.id],
    });
    expect(await ctx.linkedTaskIds(billing.id)).toEqual([c.id]);
    expect(events).toHaveLength(2);

    const tooMany = await request(
      `/${billing.id}/tasks`,
      json("POST", {
        taskIds: Array.from({ length: 201 }, (_, i) => `t${i}`),
      }),
    );
    expect(tooMany.status).toBe(400);

    const activity = await moduleActivity([a.id]);
    expect(activity).toEqual(
      expect.arrayContaining([
        {
          taskId: a.id,
          type: "module_added",
          eventData: { moduleId: billing.id, moduleName: "Billing" },
        },
        {
          taskId: a.id,
          type: "module_removed",
          eventData: { moduleId: billing.id, moduleName: "Billing" },
        },
      ]),
    );
    expect(activity).toHaveLength(2);
  });

  it("refuses membership changes on archived modules", async () => {
    const { request, insertModule, createTask } = await moduleContext();
    const done = await insertModule({
      name: "Done",
      status: "completed",
      archivedAt: new Date(),
    });
    const task = await createTask();
    for (const method of ["POST", "DELETE"]) {
      const response = await request(
        `/${done.id}/tasks`,
        json(method, { taskIds: [task.id] }),
      );
      expect(response.status, method).toBe(409);
      expect(await response.text()).toBe(
        "Restore the module before editing it",
      );
    }
  });

  it("changes a task's modules from the task side", async () => {
    const ctx = await moduleContext();
    const { ok, request, createModule, createTask, insertModule, link } = ctx;
    const task = await createTask();
    const zeta = await createModule({ name: "Zeta" });
    const alpha = await createModule({ name: "alpha" });
    const beta = await createModule({ name: "Beta" });
    await link(beta.id, [task.id]);

    const put = (body: Record<string, unknown>) =>
      request(`/task/${task.id}`, json("PUT", body));

    const after = await ok<TaskModuleRef[]>(
      `/task/${task.id}`,
      json("PUT", {
        addModuleIds: [zeta.id, alpha.id],
        removeModuleIds: [beta.id],
      }),
    );
    // Active modules, ordered by name, ignoring case.
    expect(after.map((m) => m.name)).toEqual(["alpha", "Zeta"]);
    expect(after[0]).toMatchObject({ status: "backlog" });
    expect(events.map((e) => e.data.moduleId).sort()).toEqual(
      [zeta.id, alpha.id, beta.id].sort(),
    );

    // Idempotent: nothing changes, nothing is published.
    events.length = 0;
    await ok(`/task/${task.id}`, json("PUT", { addModuleIds: [zeta.id] }));
    await ok(`/task/${task.id}`, json("PUT", { removeModuleIds: [beta.id] }));
    expect(events).toEqual([]);

    const nothing = await put({ addModuleIds: [], removeModuleIds: [] });
    expect(nothing.status).toBe(400);
    expect(await nothing.text()).toBe("Nothing to change");

    const both = await put({
      addModuleIds: [zeta.id],
      removeModuleIds: [zeta.id],
    });
    expect(both.status).toBe(400);
    expect(await both.text()).toBe("A module cannot be both added and removed");

    const other = await moduleContext();
    const foreign = await other.createModule({ name: "Foreign" });
    mockAuthenticatedSession(ctx.user);
    const foreignResponse = await put({ addModuleIds: [foreign.id] });
    expect(foreignResponse.status).toBe(400);
    expect(await foreignResponse.text()).toBe(
      `Module ${foreign.id} does not belong to this task's project`,
    );

    const archivedModule = await insertModule({
      name: "Archived",
      status: "cancelled",
      archivedAt: new Date(),
    });
    const archivedResponse = await put({ addModuleIds: [archivedModule.id] });
    expect(archivedResponse.status).toBe(409);

    // Archived tasks can leave modules but not join them.
    await db
      .update(schema.taskTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.taskTable.id, task.id));
    const join = await put({ addModuleIds: [beta.id] });
    expect(join.status).toBe(409);
    expect(await join.text()).toBe("Archived tasks cannot be added to modules");
    const leave = await ok<TaskModuleRef[]>(
      `/task/${task.id}`,
      json("PUT", { removeModuleIds: [zeta.id] }),
    );
    expect(leave.map((m) => m.id)).toEqual([alpha.id]);
  });

  it("maps tasks to active modules and lists a task's modules", async () => {
    const { ok, createModule, createTask, insertModule, link, project } =
      await moduleContext();
    const task = await createTask();
    const archivedTask = await createTask({ archivedAt: new Date() });
    const active = await createModule({ name: "Active" });
    const archived = await insertModule({
      name: "Old",
      status: "completed",
      archivedAt: new Date(),
    });
    await link(active.id, [task.id, archivedTask.id]);
    await link(archived.id, [task.id]);

    const map = await ok<Array<{ taskId: string; moduleId: string }>>(
      `/project/${project.id}/task-map`,
    );
    expect(map).toEqual(
      expect.arrayContaining([
        { taskId: task.id, moduleId: active.id },
        { taskId: archivedTask.id, moduleId: active.id },
      ]),
    );
    expect(map).toHaveLength(2);

    const refs = await ok<TaskModuleRef[]>(`/task/${task.id}`);
    expect(refs).toEqual([
      { id: active.id, name: "Active", status: "backlog" },
    ]);
  });

  it("drops memberships when a task moves to another project", async () => {
    const ctx = await moduleContext("owner");
    const { app, ok, createModule, createTask, workspace } = ctx;
    const task = await createTask();
    const billing = await createModule({ name: "Billing" });
    await ok(`/${billing.id}/tasks`, json("POST", { taskIds: [task.id] }));
    const { project: destination } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    events.length = 0;

    const moved = await app.request(
      `/api/task/move/${task.id}`,
      json("PUT", { destinationProjectId: destination.id }),
    );
    expect(moved.status, await moved.clone().text()).toBe(200);

    expect(await ctx.linkedTaskIds(billing.id)).toEqual([]);
    expect(events).toEqual([
      {
        type: "module.tasks_changed",
        data: expect.objectContaining({
          projectId: ctx.project.id,
          moduleId: billing.id,
          removed: [task.id],
        }),
      },
    ]);
    const activity = await moduleActivity([task.id]);
    expect(activity.map((row) => row.type).sort()).toEqual([
      "module_added",
      "module_removed",
    ]);
  });

  it("cascades memberships when a task is deleted", async () => {
    const { createModule, createTask, link } = await moduleContext();
    const task = await createTask();
    const billing = await createModule({ name: "Billing" });
    await link(billing.id, [task.id]);
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    expect(
      await db
        .select()
        .from(schema.moduleTaskTable)
        .where(eq(schema.moduleTaskTable.moduleId, billing.id)),
    ).toEqual([]);
  });

  it("pages the module's visible tasks by number", async () => {
    const { ok, createModule, createTask, link } = await moduleContext();
    const billing = await createModule({ name: "Billing" });
    const tasks = [];
    for (let i = 0; i < 5; i++) tasks.push(await createTask());
    const hidden = await createTask({ archivedAt: new Date() });
    await link(billing.id, [...tasks.map((t) => t.id), hidden.id]);

    const page = await ok<{
      tasks: Array<{ id: string; number: number; group: string }>;
      pagination: Record<string, number>;
    }>(`/${billing.id}/tasks?page=2&limit=2`);
    expect(page.tasks.map((t) => t.number)).toEqual([3, 4]);
    expect(page.tasks[0]).toMatchObject({ group: "unstarted" });
    expect(page.pagination).toEqual({
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
  });
});
