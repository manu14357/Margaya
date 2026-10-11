import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnalyticsScene,
  analyticsScene,
  at,
  freeze,
  seedCanonical,
} from "./helpers/analytics";
import { resetTestDatabase } from "./helpers/database";

// Created vs completed (B8 §2A.6, K9).

type TrendJson = {
  from: string;
  to: string;
  bucket: string;
  metric: string;
  today: string;
  series: {
    start: string;
    rangeStart: string;
    rangeEnd: string;
    created: number;
    completed: number;
  }[];
  totals: { created: number; completed: number; net: number };
  pointsProjectIds: string[];
};

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

function trend(s: AnalyticsScene, body: Record<string, unknown>) {
  return s.ok<TrendJson>(s.post("/trend", body, s.owner));
}

describe("API integration: analytics trend", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts creations and completion events per week (§6.1)", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const result = await trend(s, {
      ...MARCH,
      bucket: "week",
      context: { weekStartsOn: 1, timeZone: "UTC" },
    });
    expect(result.series).toEqual([
      {
        start: "2026-02-23",
        rangeStart: "2026-03-01",
        rangeEnd: "2026-03-01",
        created: 0,
        completed: 0,
      },
      {
        start: "2026-03-02",
        rangeStart: "2026-03-02",
        rangeEnd: "2026-03-08",
        created: 5,
        completed: 0,
      },
      {
        start: "2026-03-09",
        rangeStart: "2026-03-09",
        rangeEnd: "2026-03-15",
        created: 1,
        completed: 1,
      },
      {
        start: "2026-03-16",
        rangeStart: "2026-03-16",
        rangeEnd: "2026-03-22",
        created: 2,
        completed: 1,
      },
      {
        start: "2026-03-23",
        rangeStart: "2026-03-23",
        rangeEnd: "2026-03-29",
        created: 0,
        completed: 1,
      },
      {
        start: "2026-03-30",
        rangeStart: "2026-03-30",
        rangeEnd: "2026-03-31",
        created: 0,
        completed: 0,
      },
    ]);
    expect(result.totals).toEqual({ created: 8, completed: 3, net: 5 });
    expect(result).toMatchObject({
      ...MARCH,
      bucket: "week",
      metric: "taskCount",
      today: "2026-03-25",
      pointsProjectIds: [s.p1.id],
    });
  });

  it("counts completion only while the task is still completed", async () => {
    const s = await analyticsScene();
    // Reopened: back in To Do with a stale completion time.
    await s.createTask({
      status: "to-do",
      createdAt: at("2026-02-01T09:00:00Z"),
      completedAt: at("2026-03-10T10:00:00Z"),
    });
    // Created before the range, completed inside it.
    await s.createTask({
      status: "done",
      createdAt: at("2026-02-01T09:00:00Z"),
      completedAt: at("2026-03-11T10:00:00Z"),
    });
    const result = await trend(s, { ...MARCH, bucket: "month" });
    expect(result.series).toEqual([
      {
        start: "2026-03-01",
        rangeStart: "2026-03-01",
        rangeEnd: "2026-03-31",
        created: 0,
        completed: 1,
      },
    ]);
  });

  it("clips the first and last month windows", async () => {
    const s = await analyticsScene();
    await s.createTask({ createdAt: at("2026-01-10T09:00:00Z") });
    await s.createTask({ createdAt: at("2026-01-20T09:00:00Z") });
    await s.createTask({ createdAt: at("2026-03-12T09:00:00Z") });
    const result = await trend(s, {
      from: "2026-01-15",
      to: "2026-03-10",
      bucket: "month",
    });
    expect(
      result.series.map(({ start, rangeStart, rangeEnd, created }) => [
        start,
        rangeStart,
        rangeEnd,
        created,
      ]),
    ).toEqual([
      ["2026-01-01", "2026-01-15", "2026-01-31", 1],
      ["2026-02-01", "2026-02-01", "2026-02-28", 0],
      ["2026-03-01", "2026-03-01", "2026-03-10", 0],
    ]);
  });

  it("refuses bad ranges and too many buckets", async () => {
    const s = await analyticsScene();
    const call = (body: Record<string, unknown>) =>
      s.post("/trend", body, s.owner);
    await s.fails(
      call({ from: "2026-03-10", to: "2026-03-01", bucket: "week" }),
      400,
      "Invalid date range",
    );
    await s.fails(
      call({ from: "2026-02-30", to: "2026-03-01", bucket: "week" }),
      400,
      "Invalid date",
    );
    const tooMany = "Too many buckets; choose months or a shorter range";
    // 107 Sunday weeks.
    await s.fails(
      call({ from: "2024-01-07", to: "2026-01-18", bucket: "week" }),
      400,
      tooMany,
    );
    await s.ok(call({ from: "2024-01-07", to: "2026-01-11", bucket: "week" }));
    // Five years plus one day.
    await s.fails(
      call({ from: "2021-01-01", to: "2026-01-02", bucket: "month" }),
      400,
      tooMany,
    );
    await s.fails(call({ ...MARCH, bucket: "day" }), 400);
  });

  it("sums points only from points projects", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const result = await trend(s, {
      ...MARCH,
      bucket: "month",
      metric: "estimatePoints",
    });
    expect(result.totals).toEqual({ created: 18, completed: 2, net: 16 });
    expect(result.metric).toBe("estimatePoints");
  });

  it("follows the archived rule and the filters", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const range = { from: "2026-02-01", to: "2026-03-31", bucket: "month" };
    const excluded = await trend(s, range);
    expect(excluded.series[0]).toMatchObject({ created: 0, completed: 0 });
    const included = await trend(s, { ...range, archived: "include" });
    expect(included.series[0]).toMatchObject({
      start: "2026-02-01",
      created: 1,
      completed: 1,
    });
    const p2 = await trend(s, { ...range, scope: { projectIds: [s.p2.id] } });
    expect(p2.totals).toEqual({ created: 2, completed: 1, net: 1 });
    const high = await trend(s, {
      ...range,
      filters: { key: "priority", operator: "in", values: ["high"] },
    });
    expect(high.totals).toEqual({ created: 4, completed: 1, net: 3 });
  });
});
