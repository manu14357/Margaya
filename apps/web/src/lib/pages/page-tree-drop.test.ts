import { describe, expect, it } from "vitest";
import {
  type DropPage,
  dropTargetFor,
  dropViolation,
  dropZoneAt,
  resolvePageDrop,
} from "./page-tree-drop";

function page(
  id: string,
  parentId: string | null,
  position: number,
  extra: Partial<DropPage> = {},
): DropPage {
  return {
    id,
    parentId,
    position,
    title: id,
    access: "public",
    ownerId: "me",
    isLocked: false,
    capabilities: { canEdit: true },
    ...extra,
  };
}

describe("dropZoneAt", () => {
  it("splits a row into before, inside (middle half) and after", () => {
    expect(dropZoneAt(2, 28)).toBe("before");
    expect(dropZoneAt(14, 28)).toBe("inside");
    expect(dropZoneAt(26, 28)).toBe("after");
  });
});

describe("dropTargetFor", () => {
  const pages = [
    page("a", null, 0),
    page("b", null, 1),
    page("b1", "b", 0),
    page("c", null, 2),
  ];

  it("reorders among siblings before or after a row", () => {
    expect(dropTargetFor(pages, "c", { overId: "b", zone: "before" })).toEqual({
      parentId: null,
      afterId: "a",
    });
    expect(dropTargetFor(pages, "c", { overId: "a", zone: "before" })).toEqual({
      parentId: null,
      afterId: null,
    });
    expect(dropTargetFor(pages, "a", { overId: "c", zone: "after" })).toEqual({
      parentId: null,
      afterId: "c",
    });
  });

  it("nests as the last child on the middle of a row", () => {
    expect(dropTargetFor(pages, "c", { overId: "b", zone: "inside" })).toEqual({
      parentId: "b",
      afterId: "b1",
    });
  });

  it("nests under the previous sibling when dragged to the right", () => {
    expect(
      dropTargetFor(pages, "c", { overId: "b", zone: "before", nest: true }),
    ).toEqual({ parentId: "a", afterId: null });
  });
});

describe("dropViolation and resolvePageDrop", () => {
  it("refuses a drop into the page's own subtree", () => {
    const pages = [page("a", null, 0), page("a1", "a", 0)];
    expect(
      resolvePageDrop(pages, "a", { overId: "a1", zone: "inside" }, "me"),
    ).toBe("invalid");
  });

  it("refuses nesting deeper than five levels", () => {
    const chain = [
      page("l1", null, 0),
      page("l2", "l1", 0),
      page("l3", "l2", 0),
      page("l4", "l3", 0),
      page("l5", "l4", 0),
      page("m", null, 1),
      page("m1", "m", 0),
    ];
    // A two-level subtree under depth 4 would reach depth 6.
    expect(
      dropViolation(chain, "m", { parentId: "l4", afterId: null }, "me"),
    ).toBe("depth");
    expect(
      dropViolation(chain, "m1", { parentId: "l4", afterId: null }, "me"),
    ).toBeNull();
  });

  it("refuses foreign pages under a private parent", () => {
    const pages = [
      page("private", null, 0, { access: "private", ownerId: "me" }),
      page("mine", null, 1),
      page("theirs", null, 2, { ownerId: "someone" }),
      page("mixed", null, 3),
      page("mixed-child", "mixed", 0, { ownerId: "someone" }),
    ];
    const into = { parentId: "private", afterId: null };
    expect(dropViolation(pages, "mine", into, "me")).toBeNull();
    expect(dropViolation(pages, "theirs", into, "me")).toBe("private");
    expect(dropViolation(pages, "mixed", into, "me")).toBe("private");
    expect(dropViolation(pages, "mine", into, "other-user")).toBe("private");
  });

  it("refuses a locked or read-only source", () => {
    const pages = [
      page("a", null, 0),
      page("locked", null, 1, { isLocked: true }),
      page("readonly", null, 2, { capabilities: { canEdit: false } }),
    ];
    const target = { parentId: null, afterId: null };
    expect(dropViolation(pages, "locked", target, "me")).toBe("locked");
    expect(dropViolation(pages, "readonly", target, "me")).toBe("readOnly");
  });

  it("answers null when the page would stay where it is", () => {
    const pages = [page("a", null, 0), page("b", null, 1)];
    expect(
      resolvePageDrop(pages, "b", { overId: "a", zone: "after" }, "me"),
    ).toBeNull();
    expect(
      resolvePageDrop(pages, "b", { overId: "a", zone: "before" }, "me"),
    ).toEqual({ parentId: null, afterId: null });
  });
});
