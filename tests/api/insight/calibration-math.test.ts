import { describe, expect, it } from "vitest";
import {
  calibrationBuckets,
  similarityQuery,
  spreadOf,
  suggestEstimate,
} from "../../../apps/api/src/insight/calibration-math";

const points = [
  { id: "p3", value: "3", position: 2 },
  { id: "p1", value: "1", position: 1 },
  { id: "p5", value: "5", position: 3 },
];

describe("calibration maths", () => {
  it("summarizes day counts with nearest-rank quartiles", () => {
    expect(spreadOf([])).toEqual({
      samples: 0,
      p25: null,
      median: null,
      p75: null,
      min: null,
      max: null,
    });
    expect(spreadOf([4, 1, 2, 3])).toEqual({
      samples: 4,
      p25: 1,
      median: 2,
      p75: 3,
      min: 1,
      max: 4,
    });
    expect(spreadOf([1.04, 2.26]).max).toBe(2.3);
  });

  it("buckets actual cycle time per estimate value in system order", () => {
    const { buckets, ordered } = calibrationBuckets(points, [
      { pointId: "p1", cycleDays: 1 },
      { pointId: "p1", cycleDays: 2 },
      { pointId: "p1", cycleDays: 1.5 },
      { pointId: "p3", cycleDays: 3 },
      { pointId: "p3", cycleDays: 4 },
      { pointId: "p3", cycleDays: 5 },
    ]);
    expect(buckets.map((bucket) => bucket.value)).toEqual(["1", "3", "5"]);
    expect(buckets[0]).toMatchObject({ samples: 3, median: 1.5, max: 2 });
    expect(buckets[1]).toMatchObject({ samples: 3, median: 4 });
    expect(buckets[2]).toMatchObject({ samples: 0, median: null });
    expect(ordered).toBe(true);
  });

  it("flags estimates that don't track actual time", () => {
    const { ordered } = calibrationBuckets(points, [
      { pointId: "p1", cycleDays: 6 },
      { pointId: "p1", cycleDays: 7 },
      { pointId: "p1", cycleDays: 8 },
      { pointId: "p3", cycleDays: 1 },
      { pointId: "p3", cycleDays: 2 },
      { pointId: "p3", cycleDays: 2 },
    ]);
    expect(ordered).toBe(false);
    // One bucket with enough samples can't say anything.
    expect(
      calibrationBuckets(points, [
        { pointId: "p1", cycleDays: 1 },
        { pointId: "p1", cycleDays: 1 },
        { pointId: "p1", cycleDays: 1 },
      ]).ordered,
    ).toBeNull();
  });

  it("suggests the weighted mode of similar tasks", () => {
    expect(
      suggestEstimate([
        { pointId: "p3", position: 2, cycleDays: 3, weight: 3 },
        { pointId: "p3", position: 2, cycleDays: 4, weight: 2 },
        { pointId: "p1", position: 1, cycleDays: 1, weight: 1 },
      ]),
    ).toEqual({ pointId: "p3", share: 0.83, matches: 3 });
  });

  it("needs three similar tasks", () => {
    expect(
      suggestEstimate([
        { pointId: "p3", position: 2, cycleDays: 3, weight: 3 },
        { pointId: "p3", position: 2, cycleDays: 4, weight: 2 },
      ]),
    ).toBeNull();
  });

  it("breaks ties toward the weighted median size, then the smaller one", () => {
    // p1 and p5 tie on weight; the median sits on p3's side of p5.
    expect(
      suggestEstimate([
        { pointId: "p1", position: 1, cycleDays: null, weight: 2 },
        { pointId: "p5", position: 3, cycleDays: null, weight: 2 },
        { pointId: "p3", position: 2, cycleDays: null, weight: 1 },
        { pointId: "p5", position: 3, cycleDays: null, weight: 0 },
      ])?.pointId,
    ).toBe("p5");
    expect(
      suggestEstimate([
        { pointId: "p1", position: 1, cycleDays: null, weight: 1 },
        { pointId: "p5", position: 3, cycleDays: null, weight: 1 },
        { pointId: "p3", position: 2, cycleDays: null, weight: 1 },
      ])?.pointId,
    ).toBe("p3");
  });

  it("builds an any-word query from a title", () => {
    expect(similarityQuery("Fix the login timeout on login")).toBe(
      '"fix" or "the" or "login" or "timeout"',
    );
    expect(similarityQuery("a b")).toBeNull();
    expect(similarityQuery("東京 タワー")).toBe('"東京" or "タワー"');
    expect(similarityQuery('"quoted" -minus OR')).toBe('"quoted" or "minus"');
  });
});
