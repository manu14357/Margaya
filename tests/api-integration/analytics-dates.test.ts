import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsScene, at, freeze, keys, values } from "./helpers/analytics";
import { resetTestDatabase } from "./helpers/database";

// Date buckets in the requester's zone (B8 §2A.4).

describe("API integration: analytics date buckets", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    freeze();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const weekly = (weekStartsOn: 0 | 1 | 6, timeZone = "UTC") => ({
    xAxis: "createdAt",
    dateBucket: "week",
    context: { weekStartsOn, timeZone },
  });

  it("starts weeks on Sunday, Monday or Saturday", async () => {
    const s = await analyticsScene();
    // Sunday.
    await s.createTask({ createdAt: at("2026-03-01T12:00:00Z") });
    expect(keys(await s.chart(weekly(0)))).toEqual(["2026-03-01"]);
    expect(keys(await s.chart(weekly(1)))).toEqual(["2026-02-23"]);
    expect(keys(await s.chart(weekly(6)))).toEqual(["2026-02-28"]);
  });

  it("uses the requester's local day", async () => {
    const s = await analyticsScene();
    // Sunday 23:30 in UTC is Monday 05:00 in Kolkata.
    await s.createTask({ createdAt: at("2026-03-01T23:30:00Z") });
    expect(keys(await s.chart(weekly(1)))).toEqual(["2026-02-23"]);
    expect(keys(await s.chart(weekly(1, "Asia/Kolkata")))).toEqual([
      "2026-03-02",
    ]);
  });

  it("follows daylight saving changes", async () => {
    const s = await analyticsScene();
    // Los Angeles moves to UTC−7 on 2026-03-08.
    await s.createTask({ createdAt: at("2026-03-08T07:30:00Z") }); // Sat 23:30 PST
    await s.createTask({ createdAt: at("2026-03-09T06:30:00Z") }); // Sun 23:30 PDT
    await s.createTask({ createdAt: at("2026-03-09T07:30:00Z") }); // Mon 00:30 PDT
    expect(values(await s.chart(weekly(1, "America/Los_Angeles")))).toEqual({
      "2026-03-02": 2,
      "2026-03-09": 1,
    });
    expect(values(await s.chart(weekly(1)))).toEqual({
      "2026-03-02": 1,
      "2026-03-09": 2,
    });
  });

  it("keeps the latest 120 month buckets", async () => {
    const s = await analyticsScene();
    await s.createTask({ createdAt: at("2015-01-15T09:00:00Z") });
    await s.createTask({ createdAt: at("2025-10-15T09:00:00Z") });
    const chart = await s.chart({ xAxis: "createdAt", dateBucket: "month" });
    expect(chart.buckets).toHaveLength(120);
    expect(chart.truncated).toMatchObject({ x: true, hiddenXCount: 10 });
    expect(keys(chart)[0]).toBe("2015-11-01");
    expect(keys(chart).at(-1)).toBe("2025-10-01");
    expect(chart.totalCount).toBe(2);
  });

  it("lands a due date written at local midnight on its own day", async () => {
    const s = await analyticsScene();
    // Midnight of Sunday 2026-03-15 in Kolkata.
    await s.createTask({ dueDate: at("2026-03-14T18:30:00Z") });
    const chart = (timeZone: string) =>
      s.chart({
        xAxis: "dueDate",
        dateBucket: "week",
        context: { weekStartsOn: 0, timeZone },
      });
    expect(keys(await chart("Asia/Kolkata"))).toEqual(["2026-03-15"]);
    expect(keys(await chart("UTC"))).toEqual(["2026-03-08"]);
  });
});
