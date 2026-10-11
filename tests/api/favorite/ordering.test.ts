import { describe, expect, it } from "vitest";
import {
  mergeRequestedOrder,
  newFavoritePosition,
} from "../../../apps/api/src/favorite/ordering";

describe("newFavoritePosition", () => {
  it("starts at 0 and then goes above the current minimum", () => {
    expect(newFavoritePosition(null)).toBe(0);
    expect(newFavoritePosition(0)).toBe(-1);
    expect(newFavoritePosition(-4)).toBe(-5);
  });
});

describe("mergeRequestedOrder", () => {
  it("applies a full reorder", () => {
    expect(mergeRequestedOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps omitted ids in their rank", () => {
    // "b" is omitted (for example hidden while archived) and stays second.
    expect(mergeRequestedOrder(["a", "b", "c", "d"], ["d", "c", "a"])).toEqual([
      "d",
      "b",
      "c",
      "a",
    ]);
  });

  it("leaves the order alone for a single id", () => {
    expect(mergeRequestedOrder(["a", "b"], ["b"])).toEqual(["a", "b"]);
  });
});
