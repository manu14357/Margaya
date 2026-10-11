import { describe, expect, it } from "vitest";
import {
  arrangePoints,
  insertAtPosition,
} from "../../../apps/api/src/estimate/positions";

type Point = { id: string; numericValue: number | null; position: number };

const point = (id: string, numericValue: number | null, position = 0) => ({
  id,
  numericValue,
  position,
});

const order = (points: Array<Point & { position: number }>) =>
  points.map(({ id, position }) => [id, position]);

describe("numeric systems", () => {
  it("sort ascending by value and renumber 1..n after an add", () => {
    const current = [point("a", 1, 1), point("b", 3, 2), point("c", 8, 3)];
    expect(
      order(arrangePoints("points", [...current, point("d", 5, 4)])),
    ).toEqual([
      ["a", 1],
      ["b", 2],
      ["d", 3],
      ["c", 4],
    ]);
  });

  it("re-sort after an edit moves a value past its neighbours", () => {
    const edited = [point("a", 1, 1), point("b", 13, 2), point("c", 8, 3)];
    expect(order(arrangePoints("points", edited))).toEqual([
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("compact the gap a delete leaves", () => {
    const remaining = [point("a", 60, 1), point("c", 240, 3)];
    expect(order(arrangePoints("time", remaining))).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });
});

describe("categories", () => {
  const sizes = [point("s", null, 1), point("m", null, 2), point("l", null, 3)];

  it("keep the given order", () => {
    expect(order(arrangePoints("categories", [...sizes].reverse()))).toEqual([
      ["l", 1],
      ["m", 2],
      ["s", 3],
    ]);
  });

  it("append a new value without a position", () => {
    const added = insertAtPosition(sizes, point("xl", null, 4));
    expect(order(arrangePoints("categories", added))).toEqual([
      ["s", 1],
      ["m", 2],
      ["l", 3],
      ["xl", 4],
    ]);
  });

  it("insert a new value at a position and shift the rest", () => {
    const added = insertAtPosition(sizes, point("xs", null, 4), 1);
    expect(order(arrangePoints("categories", added))).toEqual([
      ["xs", 1],
      ["s", 2],
      ["m", 3],
      ["l", 4],
    ]);
    const middle = insertAtPosition(sizes, point("ml", null, 4), 3);
    expect(middle.map(({ id }) => id)).toEqual(["s", "m", "ml", "l"]);
  });

  it("clamp positions past either end", () => {
    expect(
      insertAtPosition(sizes, point("x", null), 99).map(({ id }) => id),
    ).toEqual(["s", "m", "l", "x"]);
    expect(
      insertAtPosition(sizes, point("x", null), 0).map(({ id }) => id),
    ).toEqual(["x", "s", "m", "l"]);
  });

  it("compact the gap a delete leaves, keeping the order", () => {
    const remaining = [point("s", null, 1), point("l", null, 3)];
    expect(order(arrangePoints("categories", remaining))).toEqual([
      ["s", 1],
      ["l", 2],
    ]);
  });
});
