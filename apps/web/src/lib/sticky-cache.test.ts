import { describe, expect, it } from "vitest";
import {
  flattenStickies,
  insertStickyFirst,
  isBlankStickyContent,
  isSearchedStickiesKey,
  moveStickyId,
  patchStickyInData,
  removeStickyFromData,
  reorderStickiesInData,
  type StickyListData,
} from "./sticky-cache";

type Row = { id: string; content: string };

function data(...pages: string[][]): StickyListData<Row> {
  return {
    pageParams: pages.map((_, index) => (index === 0 ? null : `c${index}`)),
    pages: pages.map((ids, index) => ({
      items: ids.map((id) => ({ id, content: id })),
      nextCursor: index < pages.length - 1 ? `c${index + 1}` : null,
    })),
  };
}

const ids = (value: StickyListData<Row> | undefined) =>
  flattenStickies(value).map((row) => row.id);

describe("sticky cache helpers", () => {
  it("inserts a new sticky at the top of the first page only", () => {
    const next = insertStickyFirst(data(["a", "b"], ["c"]), {
      id: "n",
      content: "",
    });
    expect(next?.pages[0].items.map((row) => row.id)).toEqual(["n", "a", "b"]);
    expect(next?.pages[1].items.map((row) => row.id)).toEqual(["c"]);
    expect(insertStickyFirst(undefined, { id: "n", content: "" })).toBe(
      undefined,
    );
  });

  it("patches and removes a sticky wherever it is loaded", () => {
    const source = data(["a"], ["b", "c"]);
    const patched = patchStickyInData(source, "c", { content: "new" });
    expect(patched?.pages[1].items[1].content).toBe("new");
    expect(patched?.pages[0]).toBe(source.pages[0]);
    expect(patchStickyInData(source, "zzz", { content: "x" })).toBe(source);

    expect(ids(removeStickyFromData(source, "b"))).toEqual(["a", "c"]);
  });

  it("reorders loaded stickies and keeps each page's size", () => {
    const next = reorderStickiesInData(data(["a", "b"], ["c"]), [
      "c",
      "a",
      "missing",
    ]);
    expect(next?.pages.map((page) => page.items.map((row) => row.id))).toEqual([
      ["c", "a"],
      ["b"],
    ]);
  });

  it("moves an id onto another's slot", () => {
    expect(moveStickyId(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveStickyId(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveStickyId(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });

  it("tells searched lists apart", () => {
    expect(isSearchedStickiesKey(["stickies", "ws", "", 30])).toBe(false);
    expect(isSearchedStickiesKey(["stickies", "ws", "ship", 30])).toBe(true);
  });
});

describe("isBlankStickyContent", () => {
  it.each([
    "",
    "   ",
    "- [ ] ",
    "- [ ]\n- [x] ",
    "## ",
    "> ",
    "1. ",
    "<br>",
    "&nbsp;",
    "\\\n",
  ])("treats %j as blank", (content) => {
    expect(isBlankStickyContent(content)).toBe(true);
  });

  it.each(["hello", "- [ ] buy milk", "## Plan", "`x`"])(
    "treats %j as text",
    (content) => {
      expect(isBlankStickyContent(content)).toBe(false);
    },
  );
});
