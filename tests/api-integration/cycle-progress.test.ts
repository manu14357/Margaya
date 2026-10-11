import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { cycleContext, day, json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { setEstimatesEnabled } from "./helpers/estimates";
import { addWorkspaceMember } from "./helpers/fixtures";

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

async function progressOf(
  app: Awaited<ReturnType<typeof cycleContext>>["app"],
  cycleId: string,
) {
  const response = await app.request(`/api/cycle/${cycleId}/progress`);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Record<string, unknown> & {
    chart: {
      scope: number;
      days: Array<{
        date: string;
        remaining: number | null;
        completed: number | null;
        ideal: number;
      }>;
    } | null;
  };
}

describe("API integration: cycle progress", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Hand-computed fixture. The cycle runs 8 days, from 4 days ago to 3 days
  // ahead. In scope: A, B, C completed; D started; E not started; F planned
  // (backlog); G cancelled; J reopened (not started, stale completedAt).
  // Out of scope: H archived, I in triage. Scope = 8 − 1 cancelled = 7.
  it("reports counts, burndown and breakdowns", async () => {
    const ctx = await cycleContext();
    const { user, workspace, project, createTask } = ctx;
    const colleague = await addWorkspaceMember(workspace.id, "member");
    await db.insert(schema.columnTable).values([
      {
        projectId: project.id,
        name: "Cancelled",
        slug: "cancelled",
        group: "cancelled",
        isFinal: true,
        position: 4,
      },
      {
        projectId: project.id,
        name: "Triage",
        slug: "triage",
        group: "triage",
        position: 5,
      },
    ]);
    const cycle = await ctx.insertCycle({
      name: "Sprint",
      startDate: day(-4),
      endDate: day(3),
    });

    const a = await createTask({
      status: "done",
      userId: user.id,
      priority: "urgent",
      completedAt: noon(day(-6)),
    });
    const b = await createTask({
      status: "done",
      userId: user.id,
      priority: "high",
      completedAt: new Date(`${day(-3)}T00:00:00Z`),
    });
    const c = await createTask({
      status: "done",
      completedAt: new Date(`${day(-1)}T23:59:00Z`),
    });
    const d = await createTask({
      status: "in-progress",
      userId: colleague.id,
      priority: "high",
    });
    const e = await createTask({ status: "to-do", priority: "no-priority" });
    const f = await createTask({ status: "planned" });
    const g = await createTask({ status: "cancelled", userId: colleague.id });
    const h = await createTask({ archivedAt: new Date() });
    const i = await createTask({ status: "triage" });
    const j = await createTask({
      status: "to-do",
      completedAt: noon(day(-2)),
    });
    await ctx.addToCycle(
      cycle.id,
      [a, b, c, d, e, f, g, h, i, j].map((task) => task.id),
    );

    await db.insert(schema.labelTable).values([
      { name: "Bug", color: "#ff0000", workspaceId: workspace.id },
      {
        name: "Bug",
        color: "#000001",
        taskId: e.id,
        workspaceId: workspace.id,
      },
      {
        name: "API",
        color: "#00ff00",
        taskId: e.id,
        workspaceId: workspace.id,
      },
      {
        name: "Bug",
        color: "#000002",
        taskId: d.id,
        workspaceId: workspace.id,
      },
      // A label on an out-of-scope task never shows up.
      {
        name: "Old",
        color: "#999999",
        taskId: h.id,
        workspaceId: workspace.id,
      },
    ]);

    const progress = await progressOf(ctx.app, cycle.id);
    expect(progress).toMatchObject({
      cycleId: cycle.id,
      isFrozen: false,
      frozenAt: null,
      today: day(0),
      counts: {
        total: 8,
        backlog: 1,
        unstarted: 2,
        started: 1,
        completed: 3,
        cancelled: 1,
      },
      pending: 4,
      // 3 ÷ (8 − 1) = 42.9%.
      progress: 43,
      // Estimates are off by default: no totals, no points chart.
      estimates: { enabled: false, estimateId: null, taskCount: 0 },
      estimateChart: null,
    });

    expect(progress.chart).toEqual({
      scope: 7,
      days: [
        { date: day(-4), completed: 1, remaining: 6, ideal: 7 },
        { date: day(-3), completed: 2, remaining: 5, ideal: 6 },
        { date: day(-2), completed: 2, remaining: 5, ideal: 5 },
        { date: day(-1), completed: 3, remaining: 4, ideal: 4 },
        { date: day(0), completed: 3, remaining: 4, ideal: 3 },
        { date: day(1), completed: null, remaining: null, ideal: 2 },
        { date: day(2), completed: null, remaining: null, ideal: 1 },
        { date: day(3), completed: null, remaining: null, ideal: 0 },
      ],
    });

    // "Integration member" sorts before "Integration Test User"; unassigned last.
    expect(progress.assignees).toEqual([
      {
        userId: colleague.id,
        name: colleague.name,
        image: null,
        total: 2,
        completed: 0,
        cancelled: 1,
        pending: 1,
      },
      {
        userId: user.id,
        name: user.name,
        image: null,
        total: 2,
        completed: 2,
        cancelled: 0,
        pending: 0,
      },
      {
        userId: null,
        name: null,
        image: null,
        total: 4,
        completed: 1,
        cancelled: 0,
        pending: 3,
      },
    ]);

    expect(progress.labels).toEqual([
      {
        name: "API",
        color: "#00ff00",
        total: 1,
        completed: 0,
        cancelled: 0,
        pending: 1,
      },
      {
        name: "Bug",
        color: "#ff0000",
        total: 2,
        completed: 0,
        cancelled: 0,
        pending: 2,
      },
      {
        name: null,
        color: null,
        total: 6,
        completed: 3,
        cancelled: 1,
        pending: 2,
      },
    ]);

    expect(progress.priorities).toEqual([
      { priority: "urgent", total: 1, completed: 1, cancelled: 0, pending: 0 },
      { priority: "high", total: 2, completed: 1, cancelled: 0, pending: 1 },
      { priority: "medium", total: 0, completed: 0, cancelled: 0, pending: 0 },
      { priority: "low", total: 4, completed: 1, cancelled: 1, pending: 2 },
      {
        priority: "no-priority",
        total: 1,
        completed: 0,
        cancelled: 0,
        pending: 1,
      },
    ]);

    // The list and detail carry the same counts and progress.
    const [listed] = await ctx.list();
    expect(listed).toMatchObject({
      id: cycle.id,
      counts: progress.counts,
      pending: 4,
      progress: 43,
    });
  });

  it("has no chart for drafts and treats all-cancelled as done", async () => {
    const ctx = await cycleContext();
    await db.insert(schema.columnTable).values({
      projectId: ctx.project.id,
      name: "Cancelled",
      slug: "cancelled",
      group: "cancelled",
      isFinal: true,
      position: 4,
    });

    const draft = await ctx.insertCycle({ name: "Draft" });
    await ctx.addToCycle(draft.id, [(await ctx.createTask()).id]);
    expect((await progressOf(ctx.app, draft.id)).chart).toBeNull();

    const empty = await ctx.insertCycle({
      startDate: day(-30),
      endDate: day(-20),
    });
    expect(await progressOf(ctx.app, empty.id)).toMatchObject({
      counts: { total: 0 },
      progress: 0,
      chart: null,
    });

    const cancelled = await ctx.insertCycle({
      startDate: day(-10),
      endDate: day(-5),
    });
    await ctx.addToCycle(cancelled.id, [
      (await ctx.createTask({ status: "cancelled" })).id,
    ]);
    expect(await progressOf(ctx.app, cancelled.id)).toMatchObject({
      counts: { total: 1, cancelled: 1 },
      progress: 100,
      chart: null,
    });
  });

  it("charts a single-day cycle", async () => {
    const ctx = await cycleContext();
    const cycle = await ctx.insertCycle({
      startDate: day(0),
      endDate: day(0),
    });
    await ctx.addToCycle(cycle.id, [
      (await ctx.createTask({ status: "done", completedAt: noon(day(0)) })).id,
      (await ctx.createTask()).id,
    ]);
    expect((await progressOf(ctx.app, cycle.id)).chart).toEqual({
      scope: 2,
      days: [{ date: day(0), completed: 1, remaining: 1, ideal: 2 }],
    });
  });
});

describe("API integration: cycle progress with estimates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Hand-computed: a points system 1, 2, 3, 5, 8 on a 4-day cycle from 2
  // days ago to 1 day ahead. In scope: A done 5 (2 days ago), B done 3
  // (yesterday), C started 8, D to-do without estimate, E cancelled 2.
  // Points scope = 5 + 3 + 8 = 16 (cancelled and unestimated weigh 0).
  it("adds estimate totals and a points burndown", async () => {
    const ctx = await cycleContext("owner");
    await db.insert(schema.columnTable).values({
      projectId: ctx.project.id,
      name: "Cancelled",
      slug: "cancelled",
      group: "cancelled",
      isFinal: true,
      position: 4,
    });
    await setEstimatesEnabled(ctx.project.id, true);
    const created = await ctx.app.request(
      `/api/estimate/${ctx.project.id}`,
      json("POST", {
        name: "Fibonacci",
        type: "points",
        values: ["1", "2", "3", "5", "8"],
      }),
    );
    expect(created.status).toBe(200);
    const system = (await created.json()) as {
      id: string;
      points: Array<{ id: string; value: string }>;
    };
    const point = (value: string) =>
      system.points.find((candidate) => candidate.value === value)?.id ?? null;

    const cycle = await ctx.insertCycle({
      startDate: day(-2),
      endDate: day(1),
    });
    const a = await ctx.createTask({
      status: "done",
      completedAt: noon(day(-2)),
      estimatePointId: point("5"),
    });
    const b = await ctx.createTask({
      status: "done",
      completedAt: noon(day(-1)),
      estimatePointId: point("3"),
    });
    const c = await ctx.createTask({
      status: "in-progress",
      estimatePointId: point("8"),
    });
    const d = await ctx.createTask({ status: "to-do" });
    const e = await ctx.createTask({
      status: "cancelled",
      estimatePointId: point("2"),
    });
    await ctx.addToCycle(
      cycle.id,
      [a, b, c, d, e].map((task) => task.id),
    );

    const progress = await progressOf(ctx.app, cycle.id);
    expect(progress.estimates).toMatchObject({
      enabled: true,
      estimateId: system.id,
      type: "points",
      isNumeric: true,
      taskCount: 5,
      estimatedTaskCount: 4,
      completedTaskCount: 2,
      completedEstimatedTaskCount: 2,
      total: 18,
      completed: 8,
      byGroup: {
        completed: { taskCount: 2, estimatedTaskCount: 2, total: 8 },
        started: { taskCount: 1, estimatedTaskCount: 1, total: 8 },
        unstarted: { taskCount: 1, estimatedTaskCount: 0, total: 0 },
        cancelled: { taskCount: 1, estimatedTaskCount: 1, total: 2 },
      },
    });
    expect(progress.estimateChart).toEqual({
      scope: 16,
      days: [
        { date: day(-2), completed: 5, remaining: 11, ideal: 16 },
        { date: day(-1), completed: 8, remaining: 8, ideal: 10.67 },
        { date: day(0), completed: 8, remaining: 8, ideal: 5.33 },
        { date: day(1), completed: null, remaining: null, ideal: 0 },
      ],
    });
    // The task-count chart is unchanged.
    expect(progress.chart?.scope).toBe(4);

    // The frozen report keeps its estimates, hidden while the feature is off.
    const target = await ctx.insertCycle({ name: "Next" });
    const done = await ctx.insertCycle({
      name: "Done",
      startDate: day(-10),
      endDate: day(-5),
    });
    await ctx.addToCycle(done.id, [
      (await ctx.createTask({ estimatePointId: point("1") })).id,
    ]);
    const transfer = await ctx.app.request(
      `/api/cycle/${done.id}/transfer`,
      json("POST", { targetCycleId: target.id }),
    );
    expect(transfer.status, await transfer.clone().text()).toBe(200);
    const frozen = await progressOf(ctx.app, done.id);
    expect(frozen).toMatchObject({
      isFrozen: true,
      estimates: { enabled: true, total: 1, estimatedTaskCount: 1 },
    });

    await setEstimatesEnabled(ctx.project.id, false);
    expect(await progressOf(ctx.app, done.id)).toMatchObject({
      isFrozen: true,
      estimates: { enabled: false, total: null },
      estimateChart: null,
    });
    expect(await progressOf(ctx.app, cycle.id)).toMatchObject({
      estimates: { enabled: false },
      estimateChart: null,
    });
  });
});
