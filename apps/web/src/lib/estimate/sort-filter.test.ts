import { describe, expect, it } from "vitest";
import { compareTasksByEstimate } from "./sort";

const pointsById = new Map([
  ["small", { position: 1 }],
  ["large", { position: 2 }],
]);

const tasks = [
  { id: "none", estimatePointId: null },
  { id: "large", estimatePointId: "large" },
  { id: "unknown", estimatePointId: "gone" },
  { id: "small", estimatePointId: "small" },
];

function order(direction: "asc" | "desc") {
  return [...tasks]
    .sort((a, b) => compareTasksByEstimate(a, b, pointsById, direction))
    .map((task) => task.id);
}

describe("compareTasksByEstimate", () => {
  it("orders by the point's position", () => {
    expect(order("asc").slice(0, 2)).toEqual(["small", "large"]);
    expect(order("desc").slice(0, 2)).toEqual(["large", "small"]);
  });

  it("keeps unestimated and unknown points last in both directions", () => {
    expect(order("asc").slice(2)).toEqual(["none", "unknown"]);
    expect(order("desc").slice(2)).toEqual(["none", "unknown"]);
  });
});
