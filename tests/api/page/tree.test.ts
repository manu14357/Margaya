import { describe, expect, it } from "vitest";
import {
  childrenMap,
  depthOf,
  fitsDepthLimit,
  isOwnDescendant,
  placeAmongSiblings,
  privateParentAllows,
  subtreeHeight,
  subtreeIds,
} from "../../../apps/api/src/page/rules";

// root ─ a ─ a1 ─ a1x
//      └ b
// other
const parentOf = new Map<string, string | null>([
  ["root", null],
  ["a", "root"],
  ["b", "root"],
  ["a1", "a"],
  ["a1x", "a1"],
  ["other", null],
]);
const children = childrenMap(parentOf);

describe("page tree rules", () => {
  it("measures depth and height", () => {
    expect(depthOf("root", parentOf)).toBe(1);
    expect(depthOf("a1x", parentOf)).toBe(4);
    expect(subtreeHeight("root", children)).toBe(4);
    expect(subtreeHeight("a", children)).toBe(3);
    expect(subtreeHeight("b", children)).toBe(1);
    expect(subtreeIds("a", children)).toEqual(["a", "a1", "a1x"]);
  });

  it("applies the 5-level limit to a moved subtree", () => {
    // "a" (3 levels) under "other" (depth 1): 1 + 3 = 4.
    expect(
      fitsDepthLimit(depthOf("other", parentOf), subtreeHeight("a", children)),
    ).toBe(true);
    // "a" under "a1x"'s depth 4 would need 7 levels.
    expect(fitsDepthLimit(4, 3)).toBe(false);
    expect(fitsDepthLimit(4, 1)).toBe(true);
    expect(fitsDepthLimit(0, 5)).toBe(true);
    expect(fitsDepthLimit(0, 6)).toBe(false);
  });

  it("detects moves into the page itself or its descendants", () => {
    expect(isOwnDescendant("a", "a", parentOf)).toBe(true);
    expect(isOwnDescendant("a", "a1x", parentOf)).toBe(true);
    expect(isOwnDescendant("a", "b", parentOf)).toBe(false);
    expect(isOwnDescendant("a1", "root", parentOf)).toBe(false);
    const looped = new Map<string, string | null>([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(isOwnDescendant("z", "x", looped)).toBe(false);
  });

  it("allows only the parent owner's own pages under a private parent", () => {
    const privateParent = { access: "private" as const, ownerId: "u1" };
    expect(privateParentAllows(privateParent, ["u1", "u1"], "u1")).toBe(true);
    expect(privateParentAllows(privateParent, ["u1", "u2"], "u1")).toBe(false);
    expect(privateParentAllows(privateParent, ["u2"], "u2")).toBe(false);
    expect(
      privateParentAllows({ access: "public", ownerId: "u1" }, ["u2"], "u3"),
    ).toBe(true);
  });

  it("places a page among siblings", () => {
    const siblings = ["p1", "p2", "p3"];
    expect(placeAmongSiblings(siblings, "new", null)).toEqual([
      "new",
      "p1",
      "p2",
      "p3",
    ]);
    expect(placeAmongSiblings(siblings, "new", "p1")).toEqual([
      "p1",
      "new",
      "p2",
      "p3",
    ]);
    expect(placeAmongSiblings(siblings, "new", "p3")).toEqual([
      "p1",
      "p2",
      "p3",
      "new",
    ]);
    // Moving within the group.
    expect(placeAmongSiblings(siblings, "p1", "p3")).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
    expect(placeAmongSiblings(siblings, "p3", null)).toEqual([
      "p3",
      "p1",
      "p2",
    ]);
    // Not a sibling, or the page itself.
    expect(placeAmongSiblings(siblings, "new", "elsewhere")).toBeNull();
    expect(placeAmongSiblings(siblings, "p2", "p2")).toBeNull();
  });
});
