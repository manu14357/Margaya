import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsScene,
  bucket,
  freeze,
  keys,
  seedCanonical,
  values,
} from "./helpers/analytics";
import { resetTestDatabase } from "./helpers/database";

describe("API integration: analytics chart (§6.1 fixture)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts tasks per group without archived or triage tasks", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "group" });
    expect(values(chart)).toEqual({
      backlog: 1,
      unstarted: 2,
      started: 1,
      completed: 3,
      cancelled: 1,
    });
    expect(keys(chart)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
    expect(chart.totalCount).toBe(8);
    expect(chart.totalValue).toBe(8);
    expect(chart.progress).toBe(43);
    expect(chart.today).toBe("2026-03-25");
    expect(chart.dateBucket).toBeNull();
    expect(chart.segments).toEqual([]);
    expect(chart.multiValued).toEqual({ x: false, segment: false });
  });

  it("counts a task once per assignee, with per-bucket progress by group", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "assignee", segment: "group" });
    // Ben before Cara by name; Unassigned last.
    expect(keys(chart)).toEqual([s.m1.id, s.m2.id, "none"]);
    const ben = bucket(chart, s.m1.id);
    expect(ben).toMatchObject({ value: 4, taskCount: 4, progress: 25 });
    expect(ben.cells).toEqual({ backlog: 1, unstarted: 2, completed: 1 });
    const cara = bucket(chart, s.m2.id);
    expect(cara).toMatchObject({ value: 3, progress: 0 });
    expect(cara.cells).toEqual({ unstarted: 1, started: 1, cancelled: 1 });
    const nobody = bucket(chart, "none");
    expect(nobody).toMatchObject({ value: 2, progress: 100 });
    expect(nobody.cells).toEqual({ completed: 2 });
    // t2 has two assignees: buckets sum to 9, the distinct total is 8.
    expect(chart.buckets.reduce((sum, b) => sum + b.value, 0)).toBe(9);
    expect(chart.totalCount).toBe(8);
    expect(chart.multiValued).toEqual({ x: true, segment: false });
    expect(chart.progress).toBe(43);
    expect(chart.segments.map((segment) => segment.key)).toEqual([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]);
    expect(chart.meta.users.map((user) => user.name).sort()).toEqual([
      "Ben",
      "Cara",
    ]);
    expect(JSON.stringify(chart.meta)).not.toContain("@example.com");
  });

  it("puts tasks in each label and colors labels from the workspace label", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "label" });
    expect(keys(chart)).toEqual(["name:Bug", "name:Feature", "none"]);
    expect(values(chart)).toEqual({
      "name:Bug": 2,
      "name:Feature": 2,
      none: 5,
    });
    expect(chart.meta.labels).toEqual([
      { key: "name:Bug", name: "Bug", color: "#dc2626" },
      { key: "name:Feature", name: "Feature", color: "#2563eb" },
    ]);
  });

  it("lets many-valued segment cells exceed the bucket value", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "priority", segment: "label" });
    expect(keys(chart)).toEqual([
      "urgent",
      "high",
      "medium",
      "low",
      "no-priority",
    ]);
    expect(bucket(chart, "urgent")).toMatchObject({
      value: 1,
      cells: { "name:Bug": 1, "name:Feature": 1 },
    });
    expect(bucket(chart, "high")).toMatchObject({
      value: 4,
      cells: { "name:Bug": 1, none: 3 },
    });
    expect(bucket(chart, "medium")).toMatchObject({
      value: 1,
      cells: { none: 1 },
    });
    expect(bucket(chart, "low")).toMatchObject({
      value: 1,
      cells: { "name:Feature": 1 },
    });
    expect(bucket(chart, "no-priority")).toMatchObject({
      value: 1,
      cells: { none: 1 },
    });
    expect(chart.multiValued).toEqual({ x: false, segment: true });
    expect(chart.segments).toEqual([
      { key: "name:Bug", value: 2, taskCount: 2 },
      { key: "name:Feature", value: 2, taskCount: 2 },
      { key: "none", value: 5, taskCount: 5 },
    ]);
  });

  it("sums points only from projects with an active points system", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "group", metric: "estimatePoints" });
    expect(values(chart)).toEqual({
      backlog: 0,
      unstarted: 3,
      started: 5,
      completed: 2,
      cancelled: 8,
    });
    // A bucket with tasks but no points is still returned.
    expect(bucket(chart, "backlog").taskCount).toBe(1);
    expect(chart.totalValue).toBe(18);
    expect(chart.totalCount).toBe(8);
    expect(chart.progress).toBe(20);
    expect(chart.pointsProjectIds).toEqual([s.p1.id]);
  });

  it("includes archived tasks in their column's group when asked", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "group", archived: "include" });
    expect(bucket(chart, "completed").value).toBe(4);
    expect(chart.totalCount).toBe(9);
    const only = await s.chart({ xAxis: "group", archived: "only" });
    expect(values(only)).toEqual({ completed: 1 });
  });

  it("counts per project in sidebar order", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({ xAxis: "project" });
    expect(keys(chart)).toEqual([s.p1.id, s.p2.id]);
    expect(values(chart)).toEqual({ [s.p1.id]: 6, [s.p2.id]: 2 });
    expect(chart.meta.projects.map((project) => project.slug)).toEqual([
      "web",
      "api",
    ]);
  });

  it("buckets completion dates by week with zero-fill and none last", async () => {
    const s = await analyticsScene();
    await seedCanonical(s);
    const chart = await s.chart({
      xAxis: "completedAt",
      dateBucket: "week",
      context: { weekStartsOn: 1, timeZone: "UTC" },
    });
    expect(chart.dateBucket).toBe("week");
    expect(keys(chart)).toEqual([
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "none",
    ]);
    expect(values(chart)).toEqual({
      "2026-03-09": 1,
      "2026-03-16": 1,
      "2026-03-23": 1,
      none: 5,
    });
    expect(bucket(chart, "2026-03-09")).toMatchObject({
      rangeStart: "2026-03-09",
      rangeEnd: "2026-03-15",
    });
  });
});
