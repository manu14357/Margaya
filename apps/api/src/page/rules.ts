import { PAGE_LIMITS, type PageAccess } from "./types";

// Page domain rules (spec §2.5). Pure functions: the controllers load the
// rows, these decide.

export const PAGE_MESSAGES = {
  notFound: "Page not found",
  parentNotFound: "Parent page not found",
  parentArchived: "Can't add pages under an archived page",
  parentOtherProject: "The parent page must be in the same project",
  tooDeep: "Pages can be nested up to 5 levels deep",
  insideItself: "A page can't be moved inside itself",
  privateParent: "Only your own pages can go under a private page",
  parentPrivate: "Make the parent page public first",
  foreignDescendants:
    "Some sub-pages belong to other people. Move them out first.",
  notSibling: "afterId must be a sibling in the destination",
  projectLimit: "This project has reached the limit of 5,000 pages",
  targetProjectLimit: "That project has reached its page limit",
  locked: "This page is locked. Unlock it to make changes.",
  archived: "This page is archived. Restore it to make changes.",
  noFields: "Provide at least one field to change",
  invalidLogo: "Choose a valid icon or emoji",
  tooLarge: "This page is too large",
  cannotEdit: "You can't edit this page",
  ownerOnlyAccess: "Only the page owner can change who can see it",
  ownerOrManager: "Only the page owner or an admin can do this",
  deleteNotArchived: "Archive the page before deleting it",
  deleteForbidden: "Only the page owner or an admin can delete it",
  sameProject: "The page is already in that project",
  projectNotFound: "Project not found",
  versionNotFound: "Version not found",
} as const;

/** The caller, with their page permissions (read once per request). */
export type PageCaller = {
  userId: string;
  /** page:read */
  canRead: boolean;
  /** page:create */
  canCreate: boolean;
  /** page:update */
  canUpdate: boolean;
  /** page:delete: a page manager (lock, archive, move and delete any visible page). */
  isManager: boolean;
};

export type PageState = {
  access: PageAccess;
  ownerId: string | null;
  isLocked: boolean;
  archivedAt: Date | null;
};

export type PageCapabilities = {
  canEdit: boolean;
  canLock: boolean;
  canChangeAccess: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canMove: boolean;
  canCreateSubpage: boolean;
  canRestoreVersion: boolean;
};

export function isPageOwner(
  page: Pick<PageState, "ownerId">,
  caller: Pick<PageCaller, "userId">,
): boolean {
  return page.ownerId !== null && page.ownerId === caller.userId;
}

/**
 * page:read, and public, or the caller's own, or (ownerless and the caller
 * manages pages). Admins never see other people's private pages.
 */
export function canSeePage(
  page: Pick<PageState, "access" | "ownerId">,
  caller: PageCaller,
): boolean {
  if (!caller.canRead) return false;
  if (page.access === "public") return true;
  if (page.ownerId === null) return caller.isManager;
  return page.ownerId === caller.userId;
}

/** Not locked and not archived. */
export function isEditableState(
  page: Pick<PageState, "isLocked" | "archivedAt">,
): boolean {
  return !page.isLocked && page.archivedAt === null;
}

/** The 409 message for a page that can't change; archived is checked first. */
export function editableStateError(
  page: Pick<PageState, "isLocked" | "archivedAt">,
): string | null {
  if (page.archivedAt !== null) return PAGE_MESSAGES.archived;
  if (page.isLocked) return PAGE_MESSAGES.locked;
  return null;
}

/** Owner or manager, with page:update: may lock, archive and move. */
export function canManagePage(
  page: Pick<PageState, "access" | "ownerId">,
  caller: PageCaller,
): boolean {
  return (
    canSeePage(page, caller) &&
    caller.canUpdate &&
    (isPageOwner(page, caller) || caller.isManager)
  );
}

/**
 * What the caller may do to a page (§2.5). `depth` is the page's own depth
 * (a root page is 1).
 */
export function pageCapabilities(
  page: PageState & { depth: number },
  caller: PageCaller,
): PageCapabilities {
  const visible = canSeePage(page, caller);
  const owner = isPageOwner(page, caller);
  const archived = page.archivedAt !== null;
  const editableState = isEditableState(page);
  const publicOrOwner = page.access === "public" || owner;

  const canEdit = visible && caller.canUpdate && editableState && publicOrOwner;
  const canManage = canManagePage(page, caller);

  return {
    canEdit,
    canLock: canManage,
    canChangeAccess: owner && caller.canUpdate && !archived,
    canArchive: canManage,
    canDelete:
      visible && archived && ((owner && caller.canUpdate) || caller.isManager),
    canDuplicate: visible && caller.canCreate,
    canMove: canManage && editableState,
    canCreateSubpage:
      visible &&
      caller.canCreate &&
      !archived &&
      publicOrOwner &&
      page.depth < PAGE_LIMITS.depth,
    canRestoreVersion: canEdit,
  };
}

// ---------------------------------------------------------------------------
// Tree rules. Depth: a root page is 1.

export type ParentMap = ReadonlyMap<string, string | null>;

/** The page's depth, following parents in `parentOf` (a root page is 1). */
export function depthOf(pageId: string, parentOf: ParentMap): number {
  let depth = 1;
  let current = parentOf.get(pageId) ?? null;
  const seen = new Set([pageId]);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = parentOf.get(current) ?? null;
  }
  return depth;
}

/** Children of each page, from a parent map. */
export function childrenMap(parentOf: ParentMap): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const [id, parentId] of parentOf) {
    if (parentId === null) continue;
    const list = children.get(parentId) ?? [];
    list.push(id);
    children.set(parentId, list);
  }
  return children;
}

/** The page and every descendant, root first (breadth-first). */
export function subtreeIds(
  rootId: string,
  children: ReadonlyMap<string, readonly string[]>,
): string[] {
  const ids = [rootId];
  const seen = new Set(ids);
  for (let index = 0; index < ids.length; index++) {
    for (const child of children.get(ids[index] as string) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      ids.push(child);
    }
  }
  return ids;
}

/** Levels in the subtree under and including `rootId` (a leaf is 1). */
export function subtreeHeight(
  rootId: string,
  children: ReadonlyMap<string, readonly string[]>,
): number {
  let height = 0;
  let level = [rootId];
  const seen = new Set(level);
  while (level.length > 0) {
    height++;
    const next: string[] = [];
    for (const id of level) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    level = next;
  }
  return height;
}

/** T2: a subtree of `height` levels fits under a parent at `parentDepth` (0 for the root). */
export function fitsDepthLimit(parentDepth: number, height: number): boolean {
  return parentDepth + height <= PAGE_LIMITS.depth;
}

/** T3: `candidateParentId` is the page itself or one of its descendants. */
export function isOwnDescendant(
  pageId: string,
  candidateParentId: string,
  parentOf: ParentMap,
): boolean {
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    if (current === pageId) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * T4: under a private parent, the caller must own the parent and every page
 * of the moved or created subtree.
 */
export function privateParentAllows(
  parent: Pick<PageState, "access" | "ownerId">,
  subtreeOwnerIds: readonly (string | null)[],
  userId: string,
): boolean {
  if (parent.access !== "private") return true;
  if (parent.ownerId !== userId) return false;
  return subtreeOwnerIds.every((ownerId) => ownerId === userId);
}

/**
 * T7: the destination sibling order with `movedId` placed right after
 * `afterId` (first when null). `siblingIds` is the current order and may
 * include `movedId`. Null when `afterId` is not a destination sibling.
 */
export function placeAmongSiblings(
  siblingIds: readonly string[],
  movedId: string,
  afterId: string | null,
): string[] | null {
  const others = siblingIds.filter((id) => id !== movedId);
  if (afterId === null) return [movedId, ...others];
  const index = others.indexOf(afterId);
  if (index === -1) return null;
  return [...others.slice(0, index + 1), movedId, ...others.slice(index + 1)];
}

// ---------------------------------------------------------------------------
// Versions (K8, §2.2).

export type NewestVersion = { ownerId: string | null; lastSavedAt: Date };

/**
 * Whether a persist updates the newest version in place (same attributed
 * user within the coalescing window) or inserts a new one. Restores always
 * insert.
 */
export function versionAction({
  newest,
  userId,
  now,
  forceNew = false,
}: {
  newest: NewestVersion | null;
  userId: string | null;
  now: Date;
  forceNew?: boolean;
}): "update" | "insert" {
  if (forceNew || !newest || userId === null) return "insert";
  if (newest.ownerId !== userId) return "insert";
  const age = now.getTime() - newest.lastSavedAt.getTime();
  return age >= 0 && age <= PAGE_LIMITS.versionCoalesceMs ? "update" : "insert";
}

/** Ids to delete so at most `limit` remain; `idsNewestFirst` is ordered by lastSavedAt. */
export function versionsBeyondLimit(
  idsNewestFirst: readonly string[],
  limit: number = PAGE_LIMITS.versionsPerPage,
): string[] {
  return idsNewestFirst.slice(limit);
}

// ---------------------------------------------------------------------------
// Titles and logos.

export function duplicateTitle(title: string): string {
  const base = title.trim() || "Untitled";
  const suffix = " (copy)";
  let truncated = base.slice(0, PAGE_LIMITS.titleLength - suffix.length);
  // Never end on half of a surrogate pair.
  if (/[\ud800-\udbff]$/.test(truncated)) truncated = truncated.slice(0, -1);
  return `${truncated}${suffix}`;
}

const EMOJI_PATTERN =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|⃣/u;

/** One emoji grapheme of at most 16 UTF-16 units. */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 16 || !EMOJI_PATTERN.test(value)) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _ of segmenter.segment(value)) {
    count++;
    if (count > 1) return false;
  }
  return count === 1;
}

/**
 * A logo pair is valid when both parts are null, or it is an emoji
 * grapheme, or an icon name from `iconNames`.
 */
export function isValidLogo(
  kind: string | null,
  value: string | null,
  iconNames: ReadonlySet<string>,
): boolean {
  if (kind === null && value === null) return true;
  if (kind === null || value === null) return false;
  if (kind === "emoji") return isSingleEmoji(value);
  if (kind === "icon") return iconNames.has(value);
  return false;
}
