import { describe, expect, it } from "vitest";
import { defaultEstimateMapping, nearestPointId } from "./mapping";
import type { EstimateType } from "./values";

function system(type: EstimateType, values: string[], prefix: string) {
  return {
    type,
    points: values.map((value, index) => ({
      id: `${prefix}${index + 1}`,
      value,
      numericValue: type === "categories" ? null : Number(value),
      position: index + 1,
    })),
  };
}

describe("defaultEstimateMapping", () => {
  it("maps equal values of the same type", () => {
    const from = system("points", ["1", "2", "3"], "a");
    const to = system("points", ["1", "2", "3", "5"], "b");
    expect(defaultEstimateMapping(from, to)).toEqual({
      a1: "b1",
      a2: "b2",
      a3: "b3",
    });
  });

  it("matches categories ignoring case", () => {
    const from = system("categories", ["s", "M"], "a");
    const to = system("categories", ["S", "m", "L"], "b");
    expect(defaultEstimateMapping(from, to)).toEqual({ a1: "b1", a2: "b2" });
  });

  it("takes the closest numeric value, the larger one on a tie", () => {
    const from = system("points", ["4", "7", "20"], "a");
    const to = system("points", ["3", "5", "8"], "b");
    // 4 sits between 3 and 5 (a tie): 5. 7 is closest to 8. 20 to 8.
    expect(defaultEstimateMapping(from, to)).toEqual({
      a1: "b2",
      a2: "b3",
      a3: "b3",
    });
  });

  it("maps by rank across types", () => {
    const from = system("categories", ["XS", "S", "M", "L", "XL"], "a");
    const to = system("points", ["1", "2", "3"], "b");
    // round((p - 1) * 2 / 4) + 1 for p = 1..5.
    expect(defaultEstimateMapping(from, to)).toEqual({
      a1: "b1",
      a2: "b2",
      a3: "b2",
      a4: "b3",
      a5: "b3",
    });
  });

  it("maps points to time by rank, not by the raw number", () => {
    const from = system("points", ["1", "2", "3"], "a");
    const to = system("time", ["60", "120", "240"], "b");
    expect(defaultEstimateMapping(from, to)).toEqual({
      a1: "b1",
      a2: "b2",
      a3: "b3",
    });
  });

  it("maps a single current value to the first target", () => {
    const from = system("categories", ["Only"], "a");
    const to = system("categories", ["Small", "Large"], "b");
    expect(defaultEstimateMapping(from, to)).toEqual({ a1: "b1" });
  });

  it("maps to no estimate when the target has no values", () => {
    const from = system("points", ["1", "2"], "a");
    expect(
      defaultEstimateMapping(from, { type: "points", points: [] }),
    ).toEqual({ a1: null, a2: null });
  });
});

describe("nearestPointId", () => {
  const points = system("points", ["1", "2", "3", "5"], "p").points;

  it("prefers the next value on a tie", () => {
    expect(nearestPointId(points, "p2")).toBe("p3");
  });

  it("falls back to the previous value at the end", () => {
    expect(nearestPointId(points, "p4")).toBe("p3");
  });

  it("returns null for an unknown point", () => {
    expect(nearestPointId(points, "missing")).toBeNull();
  });
});
