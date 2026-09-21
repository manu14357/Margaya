import { describe, expect, it } from "vitest";
import { placementWrites } from "./placement-writes";

const column = (...positions: (number | null)[]) =>
  positions.map((position, index) => ({ id: `t${index}`, position }));

describe("placementWrites", () => {
  it("writes nothing when every task already sits at its index", () => {
    expect(placementWrites(column(0, 1, 2, 3))).toEqual([]);
  });

  it("writes only the tasks an adjacent swap moved", () => {
    const tasks = column(0, 1, 2, 3);
    const swapped = [tasks[1], tasks[0], tasks[2], tasks[3]];
    expect(
      placementWrites(swapped).map(({ task, position }) => [task.id, position]),
    ).toEqual([
      ["t1", 0],
      ["t0", 1],
    ]);
  });

  it("always writes the task that moved in from another column", () => {
    const tasks = [...column(0, 1), { id: "moved", position: 2 }];
    expect(placementWrites(tasks, "moved").map(({ task }) => task.id)).toEqual([
      "moved",
    ]);
  });

  it("renumbers the tasks after a removal and legacy positions", () => {
    expect(
      placementWrites(column(0, 2, 3, null)).map(({ position }) => position),
    ).toEqual([1, 2, 3]);
  });
});
