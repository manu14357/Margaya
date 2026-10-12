import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { setEstimatesEnabled } from "./helpers/estimates";
import { addWorkspaceMember, createProjectFixture } from "./helpers/fixtures";
import { day, json, type ModuleJson, moduleContext } from "./helpers/modules";

const noon = (date: string) => new Date(`${date}T12:00:00Z`);

type Progress = Record<string, unknown> & {
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

describe("API integration: module progress", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Hand-computed fixture. The module runs 7 days, from 3 days ago to 3 days
  // ahead. In scope: A, B, H completed (H before the start); C started; E
  // planned (backlog); F cancelled. Out of scope: X archived, Y in triage,
  // and Z, a stale link to a task of another project.
  // Scope = 6 − 1 cancelled = 5; progress = 3 ÷ 5 = 60%.
  it("reports counts, burndown and breakdowns", async () => {
    const ctx = await moduleContext();
    const { user, workspace, project, createTask, ok } = ctx;
    const colleague = await addWorkspaceMember(workspace.id, "member");
    await extraColumns(project.id);
    const billing = await ctx.insertModule({
      name: "Billing",
      startDate: day(-3),
      targetDate: day(3),
    });

    const a = await createTask({
      status: "done",
      userId: user.id,
      priority: "urgent",
      completedAt: noon(day(-2)),
    });
    const b = await createTask({
      status: "done",
      userId: user.id,
      completedAt: new Date(`${day(0)}T00:00:00Z`),
    });
    const h = await createTask({
      status: "done",
      completedAt: noon(day(-10)),
    });
    const c = await createTask({
      status: "in-progress",
      userId: colleague.id,
      priority: "high",
    });
    const e = await createTask({ status: "planned" });
    const f = await createTask({ status: "cancelled", userId: colleague.id });
    const x = await createTask({ archivedAt: new Date() });
    const y = await createTask({ status: "triage" });
    const { project: other } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [z] = await db
      .insert(schema.taskTable)
      .values({ projectId: other.id, title: "Moved away", number: 1 })
      .returning();
    if (!z) throw new Error("fixture");
    await ctx.link(
      billing.id,
      [a, b, h, c, e, f, x, y, z].map((task) => task.id),
    );

    await db.insert(schema.labelTable).values([
      { name: "Bug", color: "#ff0000", workspaceId: workspace.id },
      {
        name: "Bug",
        color: "#000001",
        taskId: c.id,
        workspaceId: workspace.id,
      },
      {
        name: "API",
        color: "#00ff00",
        taskId: c.id,
        workspaceId: workspace.id,
      },
      {
        name: "Bug",
        color: "#000002",
        taskId: e.id,
        workspaceId: workspace.id,
      },
      {
        name: "Old",
        color: "#999999",
        taskId: x.id,
        workspaceId: workspace.id,
      },
    ]);

    const progress = await ok<Progress>(`/${billing.id}/progress`);
    expect(progress).toMatchObject({
      moduleId: billing.id,
      today: day(0),
      counts: {
        total: 6,
        backlog: 1,
        unstarted: 0,
        started: 1,
        completed: 3,
        cancelled: 1,
      },
      pending: 2,
      progress: 60,
      // Estimates are off by default: no totals, no points chart.
      estimates: { enabled: false, estimateId: null, taskCount: 0 },
      estimateChart: null,
    });

    expect(progress.chart).toEqual({
      scope: 5,
      days: [
        { date: day(-3), completed: 1, remaining: 4, ideal: 5 },
        { date: day(-2), completed: 2, remaining: 3, ideal: 4.17 },
        { date: day(-1), completed: 2, remaining: 3, ideal: 3.33 },
        { date: day(0), completed: 3, remaining: 2, ideal: 2.5 },
        { date: day(1), completed: null, remaining: null, ideal: 1.67 },
        { date: day(2), completed: null, remaining: null, ideal: 0.83 },
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
        total: 2,
        completed: 1,
        cancelled: 0,
        pending: 1,
      },
    ]);

    // C counts under both of its labels; the workspace label's color wins.
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
        total: 4,
        completed: 3,
        cancelled: 1,
        pending: 0,
      },
    ]);

    expect(progress.priorities).toEqual([
      { priority: "urgent", total: 1, completed: 1, cancelled: 0, pending: 0 },
      { priority: "high", total: 1, completed: 0, cancelled: 0, pending: 1 },
      { priority: "medium", total: 0, completed: 0, cancelled: 0, pending: 0 },
      { priority: "low", total: 4, completed: 2, cancelled: 1, pending: 1 },
      {
        priority: "no-priority",
        total: 0,
        completed: 0,
        cancelled: 0,
        pending: 0,
      },
    ]);

    // The list and detail carry the same counts and progress.
    const [listed] = await ctx.list();
    expect(listed).toMatchObject({
      id: billing.id,
      counts: progress.counts,
      pending: 2,
      progress: 60,
    });
    const detail = await ok<ModuleJson>(`/${billing.id}`);
    expect(detail.counts).toEqual(progress.counts);
  });

  it("handles empty, all-cancelled, undated and long modules", async () => {
    const ctx = await moduleContext();
    const { ok, insertModule, createTask, link, project } = ctx;
    await extraColumns(project.id);
    const progressOf = (id: string) => ok<Progress>(`/${id}/progress`);

    const empty = await insertModule({
      name: "Empty",
      startDate: day(-1),
      targetDate: day(1),
    });
    expect(await progressOf(empty.id)).toMatchObject({
      counts: { total: 0 },
      progress: 0,
      chart: null,
    });

    const cancelled = await insertModule({
      name: "Cancelled",
      startDate: day(-1),
      targetDate: day(1),
    });
    await link(cancelled.id, [
      (await createTask({ status: "cancelled" })).id,
      (await createTask({ status: "cancelled" })).id,
    ]);
    expect(await progressOf(cancelled.id)).toMatchObject({
      counts: { total: 2, cancelled: 2 },
      pending: 0,
      progress: 100,
      chart: null,
    });

    const task = await createTask();
    const undated = await insertModule({ name: "Undated", startDate: day(0) });
    const tooLong = await insertModule({
      name: "Too long",
      startDate: day(-450),
      targetDate: day(449),
    });
    const longest = await insertModule({
      name: "Longest",
      startDate: day(-365),
      targetDate: day(365),
    });
    for (const found of [undated, tooLong, longest]) {
      await link(found.id, [task.id]);
    }
    expect((await progressOf(undated.id)).chart).toBeNull();
    // 900 days is past the 731-day limit; exactly 731 still charts.
    expect((await progressOf(tooLong.id)).chart).toBeNull();
    const chart = (await progressOf(longest.id)).chart;
    expect(chart?.days).toHaveLength(731);
    expect(chart?.days[0]).toEqual({
      date: day(-365),
      completed: 0,
      remaining: 1,
      ideal: 1,
    });
  });
});

describe("API integration: module progress with estimates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Hand-computed: a time system (minutes) on a 3-day module from yesterday
  // to tomorrow. A done 60 (yesterday), B done 30 (today), C to-do 120,
  // D to-do without estimate, and X, a stale link to another project's task
  // with the same value, which never counts. Scope = 60 + 30 + 120 = 210.
  it("adds estimate totals and a points-mode chart", async () => {
    const ctx = await moduleContext("owner");
    await setEstimatesEnabled(ctx.project.id, true);
    const created = await ctx.app.request(
      `/api/estimate/${ctx.project.id}`,
      json("POST", {
        name: "Minutes",
        type: "time",
        values: ["30", "60", "120"],
      }),
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const system = (await created.json()) as {
      id: string;
      points: Array<{ id: string; value: string }>;
    };
    const point = (value: string) =>
      system.points.find((candidate) => candidate.value === value)?.id ?? null;

    const found = await ctx.insertModule({
      name: "Timed",
      startDate: day(-1),
      targetDate: day(1),
    });
    const a = await ctx.createTask({
      status: "done",
      completedAt: noon(day(-1)),
      estimatePointId: point("60"),
    });
    const b = await ctx.createTask({
      status: "done",
      completedAt: noon(day(0)),
      estimatePointId: point("30"),
    });
    const c = await ctx.createTask({ estimatePointId: point("120") });
    const d = await ctx.createTask();
    const { project: other } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
    });
    const [x] = await db
      .insert(schema.taskTable)
      .values({
        projectId: other.id,
        title: "Moved away",
        number: 1,
        estimatePointId: point("120"),
      })
      .returning();
    if (!x) throw new Error("fixture");
    await ctx.link(
      found.id,
      [a, b, c, d, x].map((task) => task.id),
    );

    const progress = await ctx.ok<Progress>(`/${found.id}/progress`);
    expect(progress.estimates).toMatchObject({
      enabled: true,
      estimateId: system.id,
      type: "time",
      isNumeric: true,
      taskCount: 4,
      estimatedTaskCount: 3,
      total: 210,
      completed: 90,
      distribution: [
        { value: "30", taskCount: 1, completedTaskCount: 1 },
        { value: "60", taskCount: 1, completedTaskCount: 1 },
        { value: "120", taskCount: 1, completedTaskCount: 0 },
      ],
    });
    expect(progress.estimateChart).toEqual({
      scope: 210,
      days: [
        { date: day(-1), completed: 60, remaining: 150, ideal: 210 },
        { date: day(0), completed: 90, remaining: 120, ideal: 105 },
        { date: day(1), completed: null, remaining: null, ideal: 0 },
      ],
    });

    // A categories system has totals but no points chart.
    const sizes = await ctx.app.request(
      `/api/estimate/${ctx.project.id}`,
      json("POST", { name: "Sizes", type: "categories", values: ["S", "M"] }),
    );
    const sizesSystem = (await sizes.json()) as { id: string };
    const switched = await ctx.app.request(
      `/api/estimate/${ctx.project.id}/${sizesSystem.id}/activate`,
      json("POST", { mapping: [] }),
    );
    expect(switched.status).toBe(200);
    expect(await ctx.ok<Progress>(`/${found.id}/progress`)).toMatchObject({
      estimates: { enabled: true, type: "categories", total: null },
      estimateChart: null,
    });
  });
});
