import { describe, expect, it } from "vitest";
import {
  mad,
  median,
  percentile,
  robustScale,
} from "../../../apps/api/src/delivery/stats";

describe("delivery stats", () => {
  it("computes medians", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("uses nearest-rank percentiles", () => {
    const values = [15, 20, 35, 40, 50];
    expect(percentile(values, 30)).toBe(20);
    expect(percentile(values, 40)).toBe(20);
    expect(percentile(values, 50)).toBe(35);
    expect(percentile(values, 100)).toBe(50);
    expect(percentile([], 50)).toBeNull();
  });

  it("computes the median absolute deviation", () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(mad([5, 5, 5])).toBe(0);
  });

  it("never returns a zero scale", () => {
    expect(robustScale([5, 5, 5, 5], 1)).toBe(1);
    expect(robustScale([20, 20, 20], 1)).toBe(2);
    expect(robustScale([1, 1, 2, 2, 4, 6, 9], 0.1)).toBeCloseTo(1.4826);
  });
});
