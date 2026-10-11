import { beforeEach, describe, expect, it } from "vitest";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  ESTIMATES_OFF,
  type EstimateJson,
  estimateActivities,
  estimateContext,
  expectEstimateInvariant,
  json,
  setEstimatesEnabled,
} from "./helpers/estimates";
import { addWorkspaceMember, createProjectFixture } from "./helpers/fixtures";

type BoardJson = {
  data: {
    columns: Array<{
      tasks: Array<{ id: string; estimatePointId: string | null }>;
    }>;
    plannedTasks: Array<{ id: string; estimatePointId: string | null }>;
  };
};

async function withPoints() {
  const ctx = await estimateContext();
  const system = await ctx.createSystem({
    name: "Fibonacci",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  });
  const [one, two, three, five, eight] = system.points as [
    EstimateJson["points"][number],
    EstimateJson["points"][number],
    EstimateJson["points"][number],
    EstimateJson["points"][number],
    EstimateJson["points"][number],
  ];
  return { ...ctx, system, one, two, three, five, eight };
}

function boardTaskIds(board: BoardJson) {
  return [
    ...board.data.columns.flatMap((column) => column.tasks),
    ...board.data.plannedTasks,
  ].map((task) => task.id);
}

describe("API integration: task estimates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("sets an estimate, shows it in every task payload and records it", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();

    const response = await ctx.setTaskEstimate(task.id, ctx.five.id);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: task.id,
      estimatePointId: ctx.five.id,
    });

    const detail = await ctx.app.request(`/api/task/${task.id}`);
    expect(await detail.json()).toMatchObject({ estimatePointId: ctx.five.id });

    const board = (await (
      await ctx.app.request(`/api/task/tasks/${ctx.project.id}`)
    ).json()) as BoardJson;
    const boardTask = board.data.columns
      .flatMap((column) => column.tasks)
      .find((candidate) => candidate.id === task.id);
    expect(boardTask?.estimatePointId).toBe(ctx.five.id);

    expect(await estimateActivities(task.id)).toEqual([
      {
        type: "estimate_changed",
        userId: ctx.user.id,
        content: null,
        eventData: {
          oldPointId: null,
          newPointId: ctx.five.id,
          oldValue: null,
          newValue: "5",
          oldType: null,
          newType: "points",
        },
      },
    ]);

    // The list shows how many tasks use each value.
    const [listed] = (await ctx.list()).estimates;
    expect(
      listed?.points.find((point) => point.id === ctx.five.id)?.taskCount,
    ).toBe(1);
  });

  it("records nothing for the same value and the old value when cleared", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();
    await ctx.setTaskEstimate(task.id, ctx.three.id);

    const same = await ctx.setTaskEstimate(task.id, ctx.three.id);
    expect(same.status).toBe(200);
    expect(await estimateActivities(task.id)).toHaveLength(1);

    const cleared = await ctx.setTaskEstimate(task.id, null);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ estimatePointId: null });
    const history = await estimateActivities(task.id);
    expect(history).toHaveLength(2);
    expect(history[1]?.eventData).toEqual({
      oldPointId: ctx.three.id,
      newPointId: null,
      oldValue: "3",
      newValue: null,
      oldType: "points",
      newType: null,
    });
  });

  it("refuses values of an inactive system or another project", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();
    const inactive = await ctx.createSystem({
      name: "Sizes",
      type: "categories",
      values: ["S", "M"],
    });
    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });
    await setEstimatesEnabled(other.project.id, true);
    const foreign = await ctx.createSystem(
      { name: "Foreign", type: "points", values: ["1", "2"] },
      other.project.id,
    );

    for (const pointId of [
      inactive.points[0]?.id ?? "",
      foreign.points[0]?.id ?? "",
      "unknown",
    ]) {
      const response = await ctx.setTaskEstimate(task.id, pointId);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Estimate point does not belong to this project's active estimate system",
      );
    }
    expect(await ctx.pointOf(task.id)).toBeNull();
    expect(await estimateActivities(task.id)).toEqual([]);
  });

  it("creates tasks with an estimate only while the feature is on", async () => {
    const ctx = await withPoints();
    const body = {
      title: "Estimated",
      description: "",
      priority: "low",
      status: "to-do",
    };

    const created = await ctx.app.request(
      `/api/task/${ctx.project.id}`,
      json("POST", { ...body, estimatePointId: ctx.eight.id }),
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const task = (await created.json()) as {
      id: string;
      estimatePointId: string;
    };
    expect(task.estimatePointId).toBe(ctx.eight.id);
    expect(await ctx.pointOf(task.id)).toBe(ctx.eight.id);

    const invalid = await ctx.app.request(
      `/api/task/${ctx.project.id}`,
      json("POST", { ...body, estimatePointId: "unknown" }),
    );
    expect(invalid.status).toBe(400);

    await setEstimatesEnabled(ctx.project.id, false);
    const blocked = await ctx.app.request(
      `/api/task/${ctx.project.id}`,
      json("POST", { ...body, estimatePointId: ctx.eight.id }),
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toBe(ESTIMATES_OFF);

    // Clients that never send an estimate are unaffected.
    for (const extra of [{}, { estimatePointId: null }]) {
      const plain = await ctx.app.request(
        `/api/task/${ctx.project.id}`,
        json("POST", { ...body, ...extra }),
      );
      expect(plain.status).toBe(200);
      expect(await plain.json()).toMatchObject({ estimatePointId: null });
    }
  });

  it("keeps the estimate through a full update", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();
    await ctx.setTaskEstimate(task.id, ctx.two.id);

    const response = await ctx.app.request(
      `/api/task/${task.id}`,
      json("PUT", {
        title: "Renamed",
        status: "in-progress",
        projectId: ctx.project.id,
        priority: "high",
        position: 0,
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Renamed",
      estimatePointId: ctx.two.id,
    });
  });

  it("clears the estimate when the task moves to another project", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();
    await ctx.setTaskEstimate(task.id, ctx.eight.id);
    const destination = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "dst",
    });

    const response = await ctx.app.request(
      `/api/task/move/${task.id}`,
      json("PUT", { destinationProjectId: destination.project.id }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      task: { id: task.id, estimatePointId: null },
    });
    expect(await ctx.pointOf(task.id)).toBeNull();

    const history = await estimateActivities(task.id);
    expect(history.at(-1)?.eventData).toEqual({
      oldPointId: ctx.eight.id,
      newPointId: null,
      oldValue: "8",
      newValue: null,
      oldType: "points",
      newType: null,
      reason: "task_moved",
    });
    await expectEstimateInvariant();

    // A task without an estimate moves without estimate history.
    const plain = await ctx.createTask();
    await ctx.app.request(
      `/api/task/move/${plain.id}`,
      json("PUT", { destinationProjectId: destination.project.id }),
    );
    expect(await estimateActivities(plain.id)).toEqual([]);
  });

  it("filters and sorts the board by estimate, unestimated tasks last", async () => {
    const ctx = await withPoints();
    const small = await ctx.createTask();
    const large = await ctx.createTask();
    const none = await ctx.createTask();
    const medium = await ctx.createTask({ status: "planned" });
    await ctx.assignPoint([small.id], ctx.one.id);
    await ctx.assignPoint([large.id], ctx.eight.id);
    await ctx.assignPoint([medium.id], ctx.three.id);

    const board = async (query: string) =>
      boardTaskIds(
        (await (
          await ctx.app.request(`/api/task/tasks/${ctx.project.id}?${query}`)
        ).json()) as BoardJson,
      );

    expect((await board(`estimatePointId=${ctx.one.id},none`)).sort()).toEqual(
      [small.id, none.id].sort(),
    );
    expect(await board(`estimatePointId=${ctx.eight.id}`)).toEqual([large.id]);
    expect(await board("estimatePointId=none")).toEqual([none.id]);

    const ordered = async (sortOrder: string) => {
      const response = await ctx.app.request(
        `/api/task/tasks/${ctx.project.id}?sortBy=estimate&sortOrder=${sortOrder}&limit=100`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as BoardJson;
      // Page order before the board splits tasks into columns.
      return [
        ...body.data.columns.flatMap((column) => column.tasks),
        ...body.data.plannedTasks,
      ];
    };
    const asc = await ordered("asc");
    const desc = await ordered("desc");
    // Within the to-do column the page order is kept.
    const todoIds = (tasks: Array<{ id: string }>) =>
      tasks
        .map((task) => task.id)
        .filter((id) => [small.id, large.id, none.id].includes(id));
    expect(todoIds(asc)).toEqual([small.id, large.id, none.id]);
    expect(todoIds(desc)).toEqual([large.id, small.id, none.id]);
  });

  it("lets viewers read, members estimate tasks and admins manage", async () => {
    const ctx = await withPoints();
    const task = await ctx.createTask();
    const base = `/${ctx.project.id}/${ctx.system.id}`;
    const managing: Array<[string, string, RequestInit]> = [
      [
        "create",
        `/${ctx.project.id}`,
        json("POST", { name: "New", type: "points", values: ["1", "2"] }),
      ],
      ["rename", base, json("PUT", { name: "Renamed" })],
      ["activate", `${base}/activate`, json("POST", { mapping: [] })],
      ["addPoint", `${base}/points`, json("POST", { value: "13" })],
      [
        "editPoint",
        `${base}/points/${ctx.two.id}`,
        json("PUT", { value: "4" }),
      ],
      ["deletePoint", `${base}/points/${ctx.two.id}`, { method: "DELETE" }],
      [
        "reorder",
        `${base}/points/reorder`,
        json("PUT", { pointIds: [ctx.one.id] }),
      ],
      ["delete", base, { method: "DELETE" }],
    ];

    for (const role of ["viewer", "member"]) {
      mockAuthenticatedSession(
        await addWorkspaceMember(ctx.workspace.id, role),
      );
      expect((await ctx.request(`/${ctx.project.id}`)).status, role).toBe(200);
      expect(
        (
          await ctx.request(
            `/${ctx.project.id}/totals`,
            json("POST", { taskIds: [task.id] }),
          )
        ).status,
        role,
      ).toBe(200);
      for (const [name, path, init] of managing) {
        const response = await ctx.request(path, init);
        expect(response.status, `${role} ${name}`).toBe(403);
        expect(await response.text()).toBe("Insufficient permissions");
      }
      const setOnTask = await ctx.setTaskEstimate(task.id, ctx.one.id);
      expect(setOnTask.status, role).toBe(role === "viewer" ? 403 : 200);
    }

    mockAuthenticatedSession(
      await addWorkspaceMember(ctx.workspace.id, "admin"),
    );
    expect((await ctx.setTaskEstimate(task.id, ctx.two.id)).status).toBe(200);
    const [name, path, init] = managing[1] as [string, string, RequestInit];
    expect((await ctx.request(path, init)).status, name).toBe(200);
  });

  it("sets estimates in bulk within one project", async () => {
    const ctx = await withPoints();
    const a = await ctx.createTask();
    const b = await ctx.createTask();
    const c = await ctx.createTask();
    await ctx.assignPoint([c.id], ctx.five.id);

    const bulk = (taskIds: string[], value: string | null) =>
      ctx.app.request(
        "/api/task/bulk",
        json("PATCH", { taskIds, operation: "updateEstimate", value }),
      );

    const response = await bulk([a.id, b.id, c.id], ctx.five.id);
    expect(response.status, await response.clone().text()).toBe(200);
    // c already had the value.
    expect(await response.json()).toEqual({ success: true, updatedCount: 2 });
    for (const id of [a.id, b.id, c.id]) {
      expect(await ctx.pointOf(id)).toBe(ctx.five.id);
    }
    expect(await estimateActivities(a.id)).toHaveLength(1);
    expect(await estimateActivities(c.id)).toHaveLength(0);

    const cleared = await bulk([a.id, b.id], null);
    expect(await cleared.json()).toEqual({ success: true, updatedCount: 2 });
    expect(await ctx.pointOf(a.id)).toBeNull();

    expect((await bulk([a.id], "unknown")).status).toBe(400);

    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });
    const foreignTask = await ctx.createTask({
      projectId: other.project.id,
      columnId: other.columns.todo.id,
    });
    const mixed = await bulk([a.id, foreignTask.id], ctx.one.id);
    expect(mixed.status).toBe(400);
    expect(await mixed.text()).toBe(
      "All tasks must belong to the same project to set an estimate",
    );

    await setEstimatesEnabled(ctx.project.id, false);
    const off = await bulk([a.id], ctx.one.id);
    expect(off.status).toBe(403);
    expect(await off.text()).toBe(ESTIMATES_OFF);

    mockAuthenticatedSession(
      await addWorkspaceMember(ctx.workspace.id, "viewer"),
    );
    await setEstimatesEnabled(ctx.project.id, true);
    expect((await bulk([a.id], ctx.one.id)).status).toBe(403);
    await expectEstimateInvariant();
  });
});
