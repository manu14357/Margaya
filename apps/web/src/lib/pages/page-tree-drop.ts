import {
  childrenOf,
  indexPages,
  MAX_PAGE_DEPTH,
  pageDepth,
  subtreeHeight,
  subtreeIds,
  type TreePage,
} from "./build-page-tree";

// Where a dragged page lands in the tree, checked against the API's tree
// rules (spec §2.5 T2-T4) so an invalid drop is refused before any request.

export type DropPage = TreePage & {
  access: "public" | "private";
  ownerId: string | null;
  isLocked: boolean;
  capabilities: { canEdit: boolean };
};

/** Above the row, on its middle half (nest inside), or below it. */
export type DropZone = "before" | "inside" | "after";

export type DropIntent = {
  overId: string;
  zone: DropZone;
  /** Dragged 24 px or more to the right: nest under the previous sibling. */
  nest?: boolean;
};

export type DropTarget = { parentId: string | null; afterId: string | null };

export type DropViolation =
  | "locked"
  | "readOnly"
  | "cycle"
  | "depth"
  | "private";

export const NEST_OFFSET_PX = 24;

/** The zone of a row hit at `offsetY` (0 = top edge) of a `height` row. */
export function dropZoneAt(offsetY: number, height: number): DropZone {
  if (height <= 0) return "after";
  const ratio = offsetY / height;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

function intoParent(
  pages: readonly DropPage[],
  parentId: string,
  activeId: string,
): DropTarget {
  const children = childrenOf(pages, parentId).filter(
    (page) => page.id !== activeId,
  );
  return { parentId, afterId: children.at(-1)?.id ?? null };
}

/** The new parent and predecessor for a drop, before the rules apply. */
export function dropTargetFor(
  pages: readonly DropPage[],
  activeId: string,
  intent: DropIntent,
): DropTarget | null {
  const over = pages.find((page) => page.id === intent.overId);
  if (!over || over.id === activeId) return null;

  if (intent.zone === "inside") return intoParent(pages, over.id, activeId);

  if (intent.zone === "after") {
    if (intent.nest) return intoParent(pages, over.id, activeId);
    return { parentId: over.parentId, afterId: over.id };
  }

  const siblings = childrenOf(pages, over.parentId).filter(
    (page) => page.id !== activeId,
  );
  const overIndex = siblings.findIndex((page) => page.id === over.id);
  const previous = overIndex > 0 ? siblings[overIndex - 1] : undefined;
  if (intent.nest && previous) {
    return intoParent(pages, previous.id, activeId);
  }
  return { parentId: over.parentId, afterId: previous?.id ?? null };
}

/** Why the API would refuse a target, or null when it would accept it. */
export function dropViolation(
  pages: readonly DropPage[],
  activeId: string,
  target: DropTarget,
  userId: string | undefined,
): DropViolation | null {
  const byId = indexPages(pages);
  const active = byId.get(activeId);
  if (!active) return "readOnly";
  if (active.isLocked) return "locked";
  if (!active.capabilities.canEdit) return "readOnly";
  if (!target.parentId) return null;

  const parent = byId.get(target.parentId);
  if (!parent) return "readOnly";
  const subtree = subtreeIds(pages, activeId);
  if (subtree.has(parent.id)) return "cycle";

  const newDepth = pageDepth(byId, parent) + 1;
  if (newDepth + subtreeHeight(pages, activeId) - 1 > MAX_PAGE_DEPTH) {
    return "depth";
  }

  if (parent.access === "private") {
    if (!userId || parent.ownerId !== userId) return "private";
    for (const id of subtree) {
      if (byId.get(id)?.ownerId !== userId) return "private";
    }
  }
  return null;
}

/** True when the target leaves the page where it already is. */
export function isSamePlace(
  pages: readonly DropPage[],
  activeId: string,
  target: DropTarget,
): boolean {
  const active = pages.find((page) => page.id === activeId);
  if (!active || active.parentId !== target.parentId) return false;
  const siblings = childrenOf(pages, target.parentId);
  const index = siblings.findIndex((page) => page.id === activeId);
  const previous = index > 0 ? siblings[index - 1].id : null;
  return previous === target.afterId;
}

/**
 * Resolves a drop: the target, "invalid" when the rules refuse it, or null
 * when nothing would change.
 */
export function resolvePageDrop(
  pages: readonly DropPage[],
  activeId: string,
  intent: DropIntent,
  userId: string | undefined,
): DropTarget | "invalid" | null {
  const target = dropTargetFor(pages, activeId, intent);
  if (!target) return null;
  if (dropViolation(pages, activeId, target, userId)) return "invalid";
  if (isSamePlace(pages, activeId, target)) return null;
  return target;
}
