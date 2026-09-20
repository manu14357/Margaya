import { describe, expect, it } from "vitest";
import {
  applyPageMove,
  buildPageTree,
  flattenAllPages,
  flattenPageTree,
  indexPages,
  pageAncestors,
  pageDepth,
  subtreeHeight,
  subtreeIds,
  type TreePage,
} from "./build-page-tree";
import { filterPages } from "./filter-sort-pages";

function page(
  id: string,
  parentId: string | null,
  position: number,
  extra: Partial<TreePage> = {},
): TreePage {
  return { id, parentId, position, title: id.toUpperCase(), ...extra };
}

describe("buildPageTree", () => {
  it("orders siblings by position, then id", () => {
    const tree = buildPageTree([
      page("b", null, 1),
      page("a", null, 0),
      page("c", null, 1),
    ]);
    expect(tree.map((node) => node.page.id)).toEqual(["a", "b", "c"]);
  });

  it("nests children with depth and the ancestor path", () => {
    const tree = buildPageTree([
      page("root", null, 0),
      page("child", "root", 0),
      page("grandchild", "child", 0),
    ]);
    const [root] = tree;
    const [child] = root.children;
    const [grandchild] = child.children;
    expect(root.depth).toBe(1);
    expect(child.depth).toBe(2);
    expect(grandchild.depth).toBe(3);
    expect(grandchild.path.map((ancestor) => ancestor.id)).toEqual([
      "root",
      "child",
    ]);
  });

  it("hangs pages whose parent is not shown at the top level", () => {
    const tree = buildPageTree([
      page("a", null, 0),
      page("orphan", "hidden-parent", 0),
    ]);
    expect(tree.map((node) => node.page.id)).toEqual(["a", "orphan"]);
    expect(tree[1].depth).toBe(1);
  });

  it("builds the tree of one tab (archived pages left out)", () => {
    const pages = [
      { ...page("a", null, 0), access: "public" as const },
      {
        ...page("b", "a", 0),
        access: "public" as const,
        archivedAt: "2026-01-01T00:00:00Z",
      },
      { ...page("c", "a", 1), access: "public" as const },
    ].map((item) => ({
      ...item,
      ownerId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }));
    const visible = filterPages(pages, {
      tab: "public",
      query: "",
      ownerIds: [],
      untitledLabel: "Untitled",
    });
    const tree = buildPageTree(visible);
    expect(flattenAllPages(tree).map((node) => node.page.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("flattens only expanded branches", () => {
    const tree = buildPageTree([
      page("a", null, 0),
      page("a1", "a", 0),
      page("b", null, 1),
      page("b1", "b", 0),
    ]);
    const rows = flattenPageTree(tree, (id) => id === "b");
    expect(rows.map((node) => node.page.id)).toEqual(["a", "b", "b1"]);
  });
});

describe("ancestry and sizes", () => {
  const pages = [
    page("root", null, 0),
    page("child", "root", 0),
    page("leaf", "child", 0),
    page("other", null, 1),
  ];
  const byId = indexPages(pages);
  const leaf = pages[2];

  it("lists ancestors root first and stops at a missing parent", () => {
    expect(pageAncestors(byId, leaf).map((p) => p.id)).toEqual([
      "root",
      "child",
    ]);
    expect(pageAncestors(byId, page("x", "missing", 0))).toEqual([]);
  });

  it("measures depth and subtree height", () => {
    expect(pageDepth(byId, leaf)).toBe(3);
    expect(subtreeHeight(pages, "root")).toBe(3);
    expect(subtreeHeight(pages, "leaf")).toBe(1);
    expect([...subtreeIds(pages, "root")].sort()).toEqual([
      "child",
      "leaf",
      "root",
    ]);
  });
});

describe("applyPageMove", () => {
  const siblings = [
    page("a", null, 0),
    page("b", null, 1),
    page("c", null, 2),
    page("x", "a", 0),
  ];

  const order = (pages: TreePage[], parentId: string | null) =>
    pages
      .filter((item) => item.parentId === parentId)
      .sort((left, right) => left.position - right.position)
      .map((item) => `${item.id}:${item.position}`);

  it("renumbers the destination siblings with the page after afterId", () => {
    const moved = applyPageMove(siblings, "c", null, "a");
    expect(order(moved, null)).toEqual(["a:0", "c:1", "b:2"]);
  });

  it("puts the page first when afterId is null", () => {
    const moved = applyPageMove(siblings, "c", null, null);
    expect(order(moved, null)).toEqual(["c:0", "a:1", "b:2"]);
  });

  it("moves a page under a new parent", () => {
    const moved = applyPageMove(siblings, "b", "a", "x");
    expect(order(moved, "a")).toEqual(["x:0", "b:1"]);
    expect(moved.find((item) => item.id === "b")?.parentId).toBe("a");
  });
});
