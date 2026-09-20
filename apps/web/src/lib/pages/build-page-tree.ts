// Pure tree helpers for pages: ordering, ancestry and the tree a panel or
// list renders. They work on the page summary fields only.

export type TreePage = {
  id: string;
  parentId: string | null;
  position: number;
  title: string;
  archivedAt?: string | Date | null;
};

export const MAX_PAGE_DEPTH = 5;

/** Sibling order: position, then id (the API's list order). */
export function comparePagePosition(a: TreePage, b: TreePage): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function indexPages<T extends TreePage>(pages: readonly T[]) {
  return new Map(pages.map((page) => [page.id, page]));
}

/**
 * The page's ancestors that are in `byId`, root first. Stops at a parent
 * that is missing (private to someone else, or not loaded) and at cycles.
 */
export function pageAncestors<T extends TreePage>(
  byId: ReadonlyMap<string, T>,
  page: TreePage,
): T[] {
  const ancestors: T[] = [];
  const seen = new Set([page.id]);
  let parentId = page.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return ancestors;
}

/** The children of `parentId` among `pages`, in sibling order. */
export function childrenOf<T extends TreePage>(
  pages: readonly T[],
  parentId: string | null,
): T[] {
  return pages
    .filter((page) => page.parentId === parentId)
    .sort(comparePagePosition);
}

/** The page and every page below it. */
export function subtreeIds(
  pages: readonly TreePage[],
  rootId: string,
): Set<string> {
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const page of pages) {
      if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) {
        ids.add(page.id);
        added = true;
      }
    }
  }
  return ids;
}

/** Depth of a page: 1 at the top level. */
export function pageDepth(
  byId: ReadonlyMap<string, TreePage>,
  page: TreePage,
): number {
  return pageAncestors(byId, page).length + 1;
}

/** Levels in the subtree rooted at `rootId`: 1 for a page without children. */
export function subtreeHeight(
  pages: readonly TreePage[],
  rootId: string,
): number {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const list = children.get(page.parentId) ?? [];
    list.push(page.id);
    children.set(page.parentId, list);
  }
  const visit = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let height = 0;
    for (const childId of children.get(id) ?? []) {
      height = Math.max(height, visit(childId, seen));
    }
    return height + 1;
  };
  return visit(rootId, new Set());
}

export type PageTreeNode<T extends TreePage> = {
  page: T;
  depth: number;
  /** Ancestors in the tree, root first. */
  path: T[];
  children: PageTreeNode<T>[];
};

/**
 * Builds the tree of `pages` (already filtered: the tree shows what it is
 * given). A page whose parent is not among them hangs at the top level.
 */
export function buildPageTree<T extends TreePage>(
  pages: readonly T[],
): PageTreeNode<T>[] {
  const byId = indexPages(pages);
  const childLists = new Map<string | null, T[]>();
  for (const page of pages) {
    const parentKey =
      page.parentId && byId.has(page.parentId) && page.parentId !== page.id
        ? page.parentId
        : null;
    const list = childLists.get(parentKey) ?? [];
    list.push(page);
    childLists.set(parentKey, list);
  }

  const seen = new Set<string>();
  const build = (parentId: string | null, path: T[]): PageTreeNode<T>[] =>
    (childLists.get(parentId) ?? [])
      .sort(comparePagePosition)
      .filter((page) => !seen.has(page.id))
      .map((page) => {
        seen.add(page.id);
        return {
          page,
          depth: path.length + 1,
          path,
          children: build(page.id, [...path, page]),
        };
      });

  return build(null, []);
}

/** The tree as rows, children shown only under expanded pages. */
export function flattenPageTree<T extends TreePage>(
  nodes: readonly PageTreeNode<T>[],
  isExpanded: (id: string) => boolean,
): PageTreeNode<T>[] {
  const rows: PageTreeNode<T>[] = [];
  const walk = (list: readonly PageTreeNode<T>[]) => {
    for (const node of list) {
      rows.push(node);
      if (node.children.length > 0 && isExpanded(node.page.id)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return rows;
}

/** Every page of the tree in display order, with its depth (for pickers). */
export function flattenAllPages<T extends TreePage>(
  nodes: readonly PageTreeNode<T>[],
): PageTreeNode<T>[] {
  return flattenPageTree(nodes, () => true);
}

/**
 * Moves a page in a list cache the way the API does: the destination
 * siblings (same parent) are renumbered 0..n-1 with the page right after
 * `afterId`, or first when it is null.
 */
export function applyPageMove<T extends TreePage>(
  pages: readonly T[],
  pageId: string,
  parentId: string | null,
  afterId: string | null,
): T[] {
  const moving = pages.find((page) => page.id === pageId);
  if (!moving) return [...pages];
  const siblings = pages
    .filter((page) => page.parentId === parentId && page.id !== pageId)
    .sort(comparePagePosition);
  const afterIndex = afterId
    ? siblings.findIndex((page) => page.id === afterId)
    : -1;
  const ordered = [...siblings];
  ordered.splice(afterIndex + 1, 0, { ...moving, parentId });
  const positions = new Map(ordered.map((page, index) => [page.id, index]));
  return pages.map((page) => {
    const position = positions.get(page.id);
    if (position === undefined) return page;
    return page.id === pageId
      ? { ...page, parentId, position }
      : { ...page, position };
  });
}
