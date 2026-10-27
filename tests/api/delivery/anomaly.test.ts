import { describe, expect, it } from "vitest";
import {
  chunkWeeks,
  detectAnomaly,
  detectFlowAnomalies,
  weekStartOf,
} from "../../../apps/api/src/delivery/anomaly";

const steady = [10, 11, 9, 10, 12, 10, 9, 11];

describe("detectAnomaly", () => {
  it("stays quiet within the normal range", () => {
    expect(
      detectAnomaly("throughput", { baseline: steady, current: 9 }),
    ).toBeNull();
    expect(detectAnomaly("wip", { baseline: steady, current: 12 })).toBeNull();
  });

  it("flags a sustained throughput drop", () => {
    const anomaly = detectAnomaly("throughput", {
      baseline: steady,
      current: 2,
    });
    expect(anomaly).toMatchObject({
      metric: "throughput",
      direction: "low",
      value: 2,
      median: 10,
    });
    expect(anomaly?.z).toBeLessThanOrEqual(-3);
  });

  it("only alerts in the harmful direction", () => {
    expect(
      detectAnomaly("throughput", { baseline: steady, current: 40 }),
    ).toBeNull();
    expect(detectAnomaly("wip", { baseline: steady, current: 1 })).toBeNull();
    expect(
      detectAnomaly("wip", { baseline: steady, current: 30 }),
    ).toMatchObject({ direction: "high" });
    expect(
      detectAnomaly("cycle_time", { baseline: steady, current: 30 }),
    ).toMatchObject({ direction: "high" });
  });

  it("uses a scale floor for a perfectly steady baseline", () => {
    const flat = [3, 3, 3, 3, 3, 3, 3, 3];
    // MAD is 0; the floor of 1 task keeps a +1 change quiet.
    expect(detectAnomaly("wip", { baseline: flat, current: 4 })).toBeNull();
    expect(detectAnomaly("wip", { baseline: flat, current: 6 })).toMatchObject({
      scale: 1,
      z: 3,
    });
  });

  it("needs enough baseline weeks and completions", () => {
    expect(
      detectAnomaly("cycle_time", {
        baseline: [2, 2, null, null, null, null, 2, 2],
        current: 30,
      }),
    ).toBeNull();
    expect(
      detectAnomaly("throughput", {
        baseline: [1, 1, 1, 1, 1, 1, 1, 1],
        current: 0,
      }),
    ).toBeNull();
    expect(
      detectAnomaly("wip", { baseline: steady, current: null }),
    ).toBeNull();
  });

  it("collects anomalies across metrics", () => {
    const anomalies = detectFlowAnomalies({
      throughput: { baseline: steady, current: 1 },
      wip: { baseline: steady, current: 10 },
      cycle_time: { baseline: steady, current: 50 },
    });
    expect(anomalies.map((a) => a.metric)).toEqual([
      "cycle_time",
      "throughput",
    ]);
  });
});

describe("flow alert windows", () => {
  it("keys a window by its Monday", () => {
    expect(weekStartOf("2026-10-21")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19");
  });

  it("splits days into whole weeks", () => {
    const days = Array.from({ length: 15 }, (_, index) => index);
    expect(chunkWeeks(days)).toEqual([
      [0, 1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12, 13],
    ]);
  });
});
