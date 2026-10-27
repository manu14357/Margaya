import { describe, expect, it } from "vitest";
import {
  capacityFromCycles,
  capacityFromThroughput,
  loadAgainst,
  suggestDeferrals,
} from "../../../apps/api/src/insight/capacity-math";

describe("capacity maths", () => {
  it("scales past cycles' completions per day to the planned length", () => {
    const capacity = capacityFromCycles(
      [
        { days: 10, completedTasks: 10, completedPoints: 20 },
        { days: 14, completedTasks: 7, completedPoints: 14 },
        { days: 10, completedTasks: 15, completedPoints: 30 },
      ],
      10,
    );
    // Per 10 days: 10, 5 and 15 tasks; 20, 10 and 30 points.
    expect(capacity).toEqual({
      tasks: { low: 5, typical: 10, high: 15 },
      points: { low: 10, typical: 20, high: 30 },
    });
  });

  it("needs two ended cycles, and points only where work was sized", () => {
    expect(
      capacityFromCycles(
        [{ days: 10, completedTasks: 5, completedPoints: 5 }],
        10,
      ),
    ).toBeNull();
    const capacity = capacityFromCycles(
      [
        { days: 7, completedTasks: 7, completedPoints: null },
        { days: 7, completedTasks: 14, completedPoints: 3 },
      ],
      7,
    );
    expect(capacity?.tasks.typical).toBe(7);
    expect(capacity?.points).toBeNull();
  });

  it("uses every window of the cycle's length over daily throughput", () => {
    // Windows of 3 days: 3, 2, 1, 3, 5.
    expect(capacityFromThroughput([1, 1, 1, 0, 0, 3, 2], 3)).toEqual({
      low: 2,
      typical: 3,
      high: 3,
    });
    expect(capacityFromThroughput([1, 1], 3)).toBeNull();
    expect(capacityFromThroughput([0, 0, 0, 0], 2)).toBeNull();
  });

  it("compares load with a usual cycle", () => {
    const capacity = { low: 8, typical: 10, high: 12 };
    expect(loadAgainst(13, capacity)).toEqual({ percent: 130, status: "over" });
    expect(loadAgainst(10, capacity)).toEqual({ percent: 100, status: "ok" });
    expect(loadAgainst(4, null)).toEqual({ percent: null, status: "unknown" });
  });

  it("defers lowest priority and fewest dependants first until it fits", () => {
    const picked = suggestDeferrals(
      [
        { id: "urgent", priority: "urgent", dependants: 0, size: 1 },
        { id: "low-blocking", priority: "low", dependants: 2, size: 1 },
        { id: "low-free", priority: "low", dependants: 0, size: 1 },
        { id: "none", priority: "no-priority", dependants: 0, size: 1 },
        { id: "medium", priority: "medium", dependants: 0, size: 1 },
      ],
      3,
    );
    expect(picked).toEqual(["none", "low-free", "low-blocking"]);
  });

  it("prefers bigger items at the same rank and stops once it fits", () => {
    expect(
      suggestDeferrals(
        [
          { id: "small", priority: "low", dependants: 0, size: 1 },
          { id: "big", priority: "low", dependants: 0, size: 5 },
          { id: "unsized", priority: "no-priority", dependants: 0, size: 0 },
        ],
        4,
      ),
    ).toEqual(["big"]);
    expect(suggestDeferrals([], 3)).toEqual([]);
    expect(
      suggestDeferrals(
        [{ id: "a", priority: "low", dependants: 0, size: 1 }],
        0,
      ),
    ).toEqual([]);
  });
});
