import { describe, expect, it } from "vitest";
import {
  fullDistribution,
  isPositive,
  summarizeScores,
  weeklyTrend,
} from "../../../apps/api/src/feedback/summary";

describe("isPositive", () => {
  it("counts the happy end of each scale", () => {
    expect(isPositive("faces3", 3)).toBe(true);
    expect(isPositive("faces3", 2)).toBe(false);
    expect(isPositive("faces5", 4)).toBe(true);
    expect(isPositive("stars", 3)).toBe(false);
    expect(isPositive("nps", 9)).toBe(true);
    expect(isPositive("nps", 8)).toBe(false);
    expect(isPositive("thumbs", 1)).toBe(true);
    expect(isPositive("thumbs", 0)).toBe(false);
  });
});

describe("summarizeScores", () => {
  it("returns nulls when there are no answers", () => {
    expect(summarizeScores("faces5", [])).toEqual({
      count: 0,
      average: null,
      satisfaction: null,
      nps: null,
    });
  });

  it("averages and shares on a five-point scale", () => {
    expect(
      summarizeScores("stars", [
        { score: 5, count: 2 },
        { score: 4, count: 1 },
        { score: 1, count: 1 },
      ]),
    ).toEqual({ count: 4, average: 3.8, satisfaction: 75, nps: null });
  });

  it("computes NPS as promoters minus detractors", () => {
    // 5 promoters, 3 passives, 2 detractors: 50% - 20% = 30.
    const summary = summarizeScores("nps", [
      { score: 10, count: 3 },
      { score: 9, count: 2 },
      { score: 8, count: 2 },
      { score: 7, count: 1 },
      { score: 3, count: 2 },
    ]);
    expect(summary.nps).toBe(30);
    expect(summary.satisfaction).toBe(50);
    expect(summary.count).toBe(10);
  });
});

describe("fullDistribution", () => {
  it("zero-fills every score the scale allows", () => {
    expect(fullDistribution("faces3", [{ score: 2, count: 4 }])).toEqual([
      { score: 1, count: 0 },
      { score: 2, count: 4 },
      { score: 3, count: 0 },
    ]);
    expect(fullDistribution("nps", [])).toHaveLength(11);
  });
});

describe("weeklyTrend", () => {
  it("groups by week, oldest first", () => {
    const trend = weeklyTrend("faces5", [
      { week: "2026-11-09", score: 5, count: 1 },
      { week: "2026-11-02", score: 2, count: 1 },
      { week: "2026-11-09", score: 3, count: 1 },
    ]);
    expect(trend.map((point) => point.week)).toEqual([
      "2026-11-02",
      "2026-11-09",
    ]);
    expect(trend[1]).toMatchObject({ count: 2, average: 4, satisfaction: 50 });
  });
});
