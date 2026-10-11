import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  analyticsScene,
  at,
  freeze,
  keys,
  seedCanonical,
  values,
} from "./helpers/analytics";
import { resetTestDatabase } from "./helpers/database";

// Natural order and the none bucket per dimension (B8 §2A.1, K5, K10).

describe("API integration: analytics dimensions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders statuses planned first, then by column, for one project", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({
      xAxis: "status",
      scope: { projectIds: [s.p1.id] },
    });
    expect(keys(chart)).toEqual([
      "planned",
      "to-do",
      "in-progress",
      "done",
      "wont-do",
    ]);
    expect(values(chart)).toEqual({
      planned: 1,
      "to-do": 1,
      "in-progress": 1,
      done: 2,
      "wont-do": 1,
    });
    expect(chart.meta.columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "done",
      "wont-do",
    ]);
  });

  it("keeps the fixed priority order", async () => {
    const s = await analyticsScene();
    await s.createTask({ priority: "low" });
    await s.createTask({ priority: "urgent" });
    await s.createTask({ priority: "no-priority" });
    await s.createTask({ priority: "medium" });
    const chart = await s.chart({ xAxis: "priority" });
    expect(keys(chart)).toEqual(["urgent", "medium", "low", "no-priority"]);
  });

  it("orders creators by name with an unknown creator last", async () => {
    const s = await analyticsScene();
    await s.createTask({ createdBy: s.m2.id });
    await s.createTask({ createdBy: s.admin.id });
    await s.createTask({ createdBy: null });
    const chart = await s.chart({ xAxis: "createdBy" });
    expect(keys(chart)).toEqual([s.admin.id, s.m2.id, "none"]);
    expect(values(chart)).toEqual({ [s.admin.id]: 1, [s.m2.id]: 1, none: 1 });
  });

  it("orders cycles by start date, drafts after, and reads cycles off as none", async () => {
    const s = await analyticsScene();
    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.p2.id));
    const cycle = async (
      projectId: string,
      name: string,
      startDate: string | null,
      endDate: string | null,
    ) => {
      const [row] = await db
        .insert(schema.cycleTable)
        .values({ projectId, name, startDate, endDate })
        .returning();
      if (!row) throw new Error("Failed to create cycle");
      return row;
    };
    const late = await cycle(s.p1.id, "Late", "2026-04-01", "2026-04-14");
    const early = await cycle(s.p1.id, "Early", "2026-03-01", "2026-03-14");
    const draft = await cycle(s.p1.id, "Draft", null, null);
    const hidden = await cycle(s.p2.id, "Hidden", "2026-03-01", "2026-03-14");
    const add = async (cycleId: string, projectId = s.p1.id) => {
      const task = await s.createTask({ projectId });
      await db
        .insert(schema.cycleTaskTable)
        .values({ taskId: task.id, cycleId });
    };
    await add(late.id);
    await add(draft.id);
    await add(early.id);
    await add(early.id);
    await add(hidden.id, s.p2.id);
    await s.createTask();

    const chart = await s.chart({ xAxis: "cycle" });
    expect(keys(chart)).toEqual([early.id, late.id, draft.id, "none"]);
    // The P2 task's cycle reads as none while P2 has cycles off (K10).
    expect(values(chart)).toEqual({
      [early.id]: 2,
      [late.id]: 1,
      [draft.id]: 1,
      none: 2,
    });
    expect(chart.meta.cycles.map((entry) => entry.name)).toEqual([
      "Early",
      "Late",
      "Draft",
    ]);
  });

  it("ignores archived modules and counts a task in each module", async () => {
    const s = await analyticsScene();
    const module = async (name: string, status: string, archived = false) => {
      const [row] = await db
        .insert(schema.moduleTable)
        .values({
          projectId: s.p1.id,
          name,
          status: status as "backlog",
          archivedAt: archived ? new Date() : null,
        })
        .returning();
      if (!row) throw new Error("Failed to create module");
      return row;
    };
    const planned = await module("Zeta", "planned");
    const backlog = await module("Alpha", "backlog");
    const archived = await module("Old", "completed", true);
    const both = await s.createTask();
    const onlyArchived = await s.createTask();
    await db.insert(schema.moduleTaskTable).values([
      { moduleId: planned.id, taskId: both.id },
      { moduleId: backlog.id, taskId: both.id },
      { moduleId: archived.id, taskId: onlyArchived.id },
    ]);
    const chart = await s.chart({ xAxis: "module" });
    // Status order first (backlog before planned), then name.
    expect(keys(chart)).toEqual([backlog.id, planned.id, "none"]);
    expect(values(chart)).toEqual({
      [backlog.id]: 1,
      [planned.id]: 1,
      none: 1,
    });
    expect(chart.totalCount).toBe(2);
    expect(chart.multiValued.x).toBe(true);
  });

  it("merges equal estimate values across projects and orders by type and value", async () => {
    const s = await analyticsScene();
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: true })
      .where(eq(schema.projectTable.id, s.p2.id));
    const [other] = await db
      .insert(schema.estimateTable)
      .values({ projectId: s.p2.id, name: "P", type: "points", isActive: true })
      .returning();
    if (!other) throw new Error("Failed to create estimate");
    const [three] = await db
      .insert(schema.estimatePointTable)
      .values({
        estimateId: other.id,
        value: "3",
        numericValue: 3,
        position: 0,
      })
      .returning();
    await s.createTask({ points: 8 });
    await s.createTask({ points: 3 });
    await s.createTask({ projectId: s.p2.id, estimatePointId: three?.id });
    await s.createTask();
    const chart = await s.chart({ xAxis: "estimate" });
    expect(keys(chart)).toEqual(["points:3", "points:8", "none"]);
    expect(values(chart)).toEqual({ "points:3": 2, "points:8": 1, none: 1 });
    expect(chart.meta.estimates).toEqual([
      { key: "points:3", type: "points", value: "3" },
      { key: "points:8", type: "points", value: "8" },
    ]);

    // Estimates off in P2: its task reads as none.
    await db
      .update(schema.projectTable)
      .set({ estimatesEnabled: false })
      .where(eq(schema.projectTable.id, s.p2.id));
    const off = await s.chart({ xAxis: "estimate" });
    expect(values(off)).toEqual({ "points:3": 1, "points:8": 1, none: 2 });
  });

  it("orders date buckets chronologically across a year boundary", async () => {
    const s = await analyticsScene();
    await s.createTask({ createdAt: at("2026-01-10T09:00:00Z") });
    await s.createTask({ createdAt: at("2025-11-03T09:00:00Z") });
    const chart = await s.chart({ xAxis: "createdAt", dateBucket: "month" });
    expect(keys(chart)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
    expect(values(chart)).toEqual({
      "2025-11-01": 1,
      "2025-12-01": 0,
      "2026-01-01": 1,
    });
    expect(chart.buckets[1]).toMatchObject({
      rangeStart: "2025-12-01",
      rangeEnd: "2025-12-31",
      taskCount: 0,
    });
  });

  it("puts tasks without a due or start date in the none bucket", async () => {
    const s = await analyticsScene();
    await s.createTask({ dueDate: at("2026-03-20T00:00:00Z") });
    await s.createTask();
    const due = await s.chart({ xAxis: "dueDate", dateBucket: "month" });
    expect(values(due)).toEqual({ "2026-03-01": 1, none: 1 });
    const start = await s.chart({ xAxis: "startDate" });
    expect(values(start)).toEqual({ none: 2 });
  });
});
