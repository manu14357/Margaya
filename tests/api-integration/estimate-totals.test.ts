import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  getEstimateTotals,
  getTaskEstimateValues,
} from "../../apps/api/src/estimate/totals";
import { resetTestDatabase } from "./helpers/database";
import {
  ESTIMATES_OFF,
  type EstimateJson,
  estimateContext,
  json,
  setEstimatesEnabled,
} from "./helpers/estimates";
import { createProjectFixture } from "./helpers/fixtures";

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

function pointIdOf(estimate: EstimateJson, value: string) {
  const point = estimate.points.find((candidate) => candidate.value === value);
  if (!point) throw new Error(`no value ${value}`);
  return point.id;
}

async function extraColumns(projectId: string) {
  await db.insert(schema.columnTable).values([
    {
      projectId,
      name: "Cancelled",
      slug: "cancelled",
      group: "cancelled",
      isFinal: true,
      position: 4,
    },
    {
      projectId,
      name: "Triage",
      slug: "triage",
      group: "triage",
      position: 5,
    },
  ]);
}

// Hand-computed fixture over a points system 0.1, 0.2, 1.25, 3, 5:
//   A done 3 · B done 0.1 · C started 0.1 · D to-do 0.2 · E planned 1.25
//   F cancelled 5 · G to-do (none) · J done (none)
//   out of scope: H archived 3, I in triage 5.
// Tasks 8, estimated 6, completed 3 (A, B, J), completed estimated 2.
// Total 3 + 0.1 + 0.1 + 0.2 + 1.25 + 5 = 9.65; completed 3.1.
async function totalsFixture() {
  const ctx = await estimateContext();
  await extraColumns(ctx.project.id);
  const system = await ctx.createSystem({
    name: "Decimals",
    type: "points",
    values: ["0.1", "0.2", "1.25", "3", "5"],
  });
  const v = (value: string) => pointIdOf(system, value);

  const tasks = {
    a: await ctx.createTask({
      status: "done",
      estimatePointId: v("3"),
      completedAt: noon("2026-06-01"),
    }),
    b: await ctx.createTask({
      status: "done",
      estimatePointId: v("0.1"),
      completedAt: noon("2026-06-02"),
    }),
    c: await ctx.createTask({
      status: "in-progress",
      estimatePointId: v("0.1"),
    }),
    d: await ctx.createTask({ status: "to-do", estimatePointId: v("0.2") }),
    e: await ctx.createTask({ status: "planned", estimatePointId: v("1.25") }),
    f: await ctx.createTask({ status: "cancelled", estimatePointId: v("5") }),
    g: await ctx.createTask({ status: "to-do" }),
    h: await ctx.createTask({
      archivedAt: new Date(),
      estimatePointId: v("3"),
    }),
    i: await ctx.createTask({ status: "triage", estimatePointId: v("5") }),
    j: await ctx.createTask({
      status: "done",
      completedAt: noon("2026-06-03"),
    }),
  };
  return { ...ctx, system, v, tasks };
}

describe("API integration: estimate totals", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("totals visible tasks per group and per value", async () => {
    const ctx = await totalsFixture();
    const taskIds = Object.values(ctx.tasks).map((task) => task.id);

    const totals = await getEstimateTotals({
      projectId: ctx.project.id,
      taskScope: { kind: "ids", taskIds },
      db,
    });
    expect(totals).toEqual({
      enabled: true,
      estimateId: ctx.system.id,
      type: "points",
      isNumeric: true,
      taskCount: 8,
      estimatedTaskCount: 6,
      completedTaskCount: 3,
      completedEstimatedTaskCount: 2,
      total: 9.65,
      completed: 3.1,
      byGroup: {
        backlog: { taskCount: 1, estimatedTaskCount: 1, total: 1.25 },
        unstarted: { taskCount: 2, estimatedTaskCount: 1, total: 0.2 },
        started: { taskCount: 1, estimatedTaskCount: 1, total: 0.1 },
        completed: { taskCount: 3, estimatedTaskCount: 2, total: 3.1 },
        cancelled: { taskCount: 1, estimatedTaskCount: 1, total: 5 },
      },
      distribution: [
        {
          pointId: ctx.v("0.1"),
          value: "0.1",
          position: 1,
          taskCount: 2,
          completedTaskCount: 1,
        },
        {
          pointId: ctx.v("0.2"),
          value: "0.2",
          position: 2,
          taskCount: 1,
          completedTaskCount: 0,
        },
        {
          pointId: ctx.v("1.25"),
          value: "1.25",
          position: 3,
          taskCount: 1,
          completedTaskCount: 0,
        },
        {
          pointId: ctx.v("3"),
          value: "3",
          position: 4,
          taskCount: 1,
          completedTaskCount: 1,
        },
        {
          pointId: ctx.v("5"),
          value: "5",
          position: 5,
          taskCount: 1,
          completedTaskCount: 0,
        },
      ],
    });

    // The route answers the same, ignoring other projects' tasks.
    const other = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });
    const [foreign] = await db
      .insert(schema.taskTable)
      .values({ projectId: other.project.id, title: "Foreign", number: 1 })
      .returning();
    const viaRoute = await ctx.ok(
      `/${ctx.project.id}/totals`,
      json("POST", { taskIds: [...taskIds, foreign?.id ?? "", "unknown"] }),
    );
    expect(viaRoute).toEqual(totals);
  });

  it("rounds sums to two decimals", async () => {
    const ctx = await totalsFixture();
    const extra = await ctx.createTask({
      status: "to-do",
      estimatePointId: ctx.v("0.1"),
    });
    const totals = await getEstimateTotals({
      projectId: ctx.project.id,
      taskScope: {
        kind: "ids",
        taskIds: [ctx.tasks.b.id, ctx.tasks.c.id, extra.id],
      },
      db,
    });
    // 0.1 + 0.1 + 0.1 is 0.30000000000000004 in floating point.
    expect(totals.total).toBe(0.3);
    expect(totals.completed).toBe(0.1);
  });

  it("gives the same totals for a membership subquery", async () => {
    const ctx = await totalsFixture();
    const taskIds = Object.values(ctx.tasks).map((task) => task.id);
    const [cycle] = await db
      .insert(schema.cycleTable)
      .values({ projectId: ctx.project.id, name: "Scope" })
      .returning();
    if (!cycle) throw new Error("no cycle");
    await db
      .insert(schema.cycleTaskTable)
      .values(taskIds.map((taskId) => ({ taskId, cycleId: cycle.id })));

    const byIds = await getEstimateTotals({
      projectId: ctx.project.id,
      taskScope: { kind: "ids", taskIds },
      db,
    });
    const bySubquery = await getEstimateTotals({
      projectId: ctx.project.id,
      taskScope: {
        kind: "subquery",
        sql: sql`select ${schema.cycleTaskTable.taskId} from ${schema.cycleTaskTable} where ${schema.cycleTaskTable.cycleId} = ${cycle.id}`,
      },
      db,
    });
    expect(bySubquery).toEqual(byIds);
  });

  it("reports counts but no sums for a categories system", async () => {
    const ctx = await estimateContext();
    const sizes = await ctx.createSystem({
      name: "Sizes",
      type: "categories",
      values: ["S", "M"],
    });
    const done = await ctx.createTask({
      status: "done",
      estimatePointId: pointIdOf(sizes, "M"),
    });
    const open = await ctx.createTask();

    const totals = await getEstimateTotals({
      projectId: ctx.project.id,
      taskScope: { kind: "ids", taskIds: [done.id, open.id] },
      db,
    });
    expect(totals).toMatchObject({
      enabled: true,
      type: "categories",
      isNumeric: false,
      taskCount: 2,
      estimatedTaskCount: 1,
      completedEstimatedTaskCount: 1,
      total: null,
      completed: null,
    });
    expect(totals.byGroup.completed).toEqual({
      taskCount: 1,
      estimatedTaskCount: 1,
      total: null,
    });
    expect(
      totals.distribution.map((row) => [row.value, row.taskCount]),
    ).toEqual([
      ["S", 0],
      ["M", 1],
    ]);
    expect(
      await getTaskEstimateValues({
        projectId: ctx.project.id,
        taskScope: { kind: "ids", taskIds: [done.id, open.id] },
        db,
      }),
    ).toEqual([]);
  });

  it("is disabled while the feature is off or no system is active", async () => {
    const ctx = await totalsFixture();
    const taskIds = [ctx.tasks.a.id];
    const disabled = {
      enabled: false,
      estimateId: null,
      type: null,
      isNumeric: false,
      taskCount: 0,
      estimatedTaskCount: 0,
      completedTaskCount: 0,
      completedEstimatedTaskCount: 0,
      total: null,
      completed: null,
      distribution: [],
    };

    await setEstimatesEnabled(ctx.project.id, false);
    expect(
      await getEstimateTotals({
        projectId: ctx.project.id,
        taskScope: { kind: "ids", taskIds },
        db,
      }),
    ).toMatchObject(disabled);
    const route = await ctx.request(
      `/${ctx.project.id}/totals`,
      json("POST", { taskIds }),
    );
    expect(route.status).toBe(403);
    expect(await route.text()).toBe(ESTIMATES_OFF);

    await setEstimatesEnabled(ctx.project.id, true);
    await ctx.ok(`/${ctx.project.id}/${ctx.system.id}`, { method: "DELETE" });
    expect(
      await ctx.ok(`/${ctx.project.id}/totals`, json("POST", { taskIds })),
    ).toMatchObject(disabled);
  });

  it("lists the estimate value of each estimated task for burndown", async () => {
    const ctx = await totalsFixture();
    const values = await getTaskEstimateValues({
      projectId: ctx.project.id,
      taskScope: {
        kind: "ids",
        taskIds: Object.values(ctx.tasks).map((task) => task.id),
      },
      db,
    });
    const byTask = new Map(values.map((row) => [row.taskId, row]));
    // Archived and triage tasks are out of scope; unestimated ones absent.
    expect([...byTask.keys()].sort()).toEqual(
      [
        ctx.tasks.a.id,
        ctx.tasks.b.id,
        ctx.tasks.c.id,
        ctx.tasks.d.id,
        ctx.tasks.e.id,
        ctx.tasks.f.id,
      ].sort(),
    );
    expect(byTask.get(ctx.tasks.a.id)).toEqual({
      taskId: ctx.tasks.a.id,
      numericValue: 3,
      completedAt: noon("2026-06-01"),
    });
    expect(byTask.get(ctx.tasks.d.id)).toMatchObject({
      numericValue: 0.2,
      completedAt: null,
    });

    await setEstimatesEnabled(ctx.project.id, false);
    expect(
      await getTaskEstimateValues({
        projectId: ctx.project.id,
        taskScope: { kind: "ids", taskIds: [ctx.tasks.a.id] },
        db,
      }),
    ).toEqual([]);
  });
});
