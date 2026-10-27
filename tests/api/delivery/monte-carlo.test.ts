import { describe, expect, it } from "vitest";
import {
  historyShortfall,
  simulateCompletion,
  summarizeForecast,
  summarizeHistory,
} from "../../../apps/api/src/delivery/monte-carlo";
import { fnv1a32, mulberry32 } from "../../../apps/api/src/delivery/random";

describe("seeded random", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("differs between seeds and hashes strings stably", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(fnv1a32("cycle:abc:2026-10-21:12")).toBe(
      fnv1a32("cycle:abc:2026-10-21:12"),
    );
    expect(fnv1a32("a")).not.toBe(fnv1a32("b"));
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });
});

describe("simulateCompletion", () => {
  it("is exact for a constant throughput", () => {
    const durations = simulateCompletion({
      remaining: 10,
      dailySamples: [1, 1, 1],
      seed: 7,
      iterations: 200,
    });
    expect(new Set(durations)).toEqual(new Set([10]));
    const summary = summarizeForecast({
      durations,
      today: "2026-10-21",
      endDate: "2026-10-30",
    });
    // Day 1 is today: ten days of work end on the 30th.
    expect(summary.p50).toEqual({ days: 10, date: "2026-10-30" });
    expect(summary.p95).toEqual({ days: 10, date: "2026-10-30" });
    expect(summary.probabilityByEnd).toBe(1);
    expect(
      summarizeForecast({
        durations,
        today: "2026-10-21",
        endDate: "2026-10-29",
      }).probabilityByEnd,
    ).toBe(0);
  });

  it("is deterministic for a seed and orders the percentiles", () => {
    const input = {
      remaining: 30,
      dailySamples: [0, 0, 1, 2, 0, 3, 1, 0, 0, 4, 1, 2, 0, 0],
      seed: 12345,
    };
    const first = simulateCompletion(input);
    const second = simulateCompletion(input);
    expect(Array.from(first)).toEqual(Array.from(second));
    const summary = summarizeForecast({
      durations: first,
      today: "2026-10-21",
      endDate: "2026-11-20",
    });
    expect(summary.p50 && summary.p85 && summary.p95).toBeTruthy();
    expect(summary.p50?.days).toBeLessThanOrEqual(summary.p85?.days ?? 0);
    expect(summary.p85?.days).toBeLessThanOrEqual(summary.p95?.days ?? 0);
    // Mean 1/day over 14 days: 30 tasks take about a month.
    expect(summary.p50?.days).toBeGreaterThan(20);
    expect(summary.p50?.days).toBeLessThan(45);
    expect(summary.probabilityByEnd).toBeGreaterThan(0);
    expect(summary.probabilityByEnd).toBeLessThan(1);
    // Pinned: the same seed must keep giving these numbers.
    expect(summary).toEqual({
      p50: { days: 30, date: "2026-11-19" },
      p85: { days: 38, date: "2026-11-27" },
      p95: { days: 43, date: "2026-12-02" },
      probabilityByEnd: 0.56,
      beyondHorizon: false,
    });
  });

  it("caps runs at the horizon", () => {
    const durations = simulateCompletion({
      remaining: 1000,
      dailySamples: [0, 0, 0, 1],
      seed: 3,
      iterations: 50,
      maxDays: 100,
    });
    expect(Math.max(...durations)).toBe(101);
    const summary = summarizeForecast({
      durations,
      today: "2026-10-21",
      endDate: null,
      maxDays: 100,
    });
    expect(summary.p50).toBeNull();
    expect(summary.beyondHorizon).toBe(true);
    expect(summary.probabilityByEnd).toBeNull();
  });

  it("gives a zero chance for an end date already past", () => {
    const durations = simulateCompletion({
      remaining: 2,
      dailySamples: [1],
      seed: 1,
      iterations: 10,
    });
    expect(
      summarizeForecast({
        durations,
        today: "2026-10-21",
        endDate: "2026-10-20",
      }).probabilityByEnd,
    ).toBe(0);
  });
});

describe("history sufficiency", () => {
  it("summarizes the sample range", () => {
    expect(summarizeHistory([0, 2, 1, 0, 4, 0, 0])).toEqual({
      days: 7,
      completed: 7,
      activeDays: 3,
      minPerDay: 0,
      maxPerDay: 4,
      perWeek: 7,
    });
  });

  it("names why the history is too thin", () => {
    expect(historyShortfall(summarizeHistory(Array(10).fill(1)))).toBe(
      "short_span",
    );
    expect(historyShortfall(summarizeHistory([...Array(20).fill(0), 4]))).toBe(
      "few_completions",
    );
    expect(
      historyShortfall(summarizeHistory([...Array(20).fill(0), 3, 3])),
    ).toBe("few_active_days");
    expect(
      historyShortfall(summarizeHistory([...Array(20).fill(0), 2, 2, 1])),
    ).toBeNull();
  });
});
