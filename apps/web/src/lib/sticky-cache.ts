import type { InfiniteData } from "@tanstack/react-query";

// Pure edits of the cached sticky lists (infinite queries keyed
// ["stickies", workspaceId, q, limit]). Every helper returns new objects and
// leaves pages it does not touch as they are.

type StickyLike = { id: string; content: string };
type PageLike<T extends StickyLike> = {
  items: T[];
  nextCursor: string | null;
};
export type StickyListData<T extends StickyLike> = InfiniteData<
  PageLike<T>,
  unknown
>;

/** The query key prefix of every sticky list of a workspace. */
export function stickiesKeyPrefix(workspaceId: string) {
  return ["stickies", workspaceId] as const;
}

export function stickiesQueryKey(
  workspaceId: string,
  q: string,
  limit: number,
) {
  return ["stickies", workspaceId, q, limit] as const;
}

/** True for a cached list filtered by a search query. */
export function isSearchedStickiesKey(queryKey: readonly unknown[]) {
  return typeof queryKey[2] === "string" && queryKey[2] !== "";
}

export function flattenStickies<T extends StickyLike>(
  data: StickyListData<T> | undefined,
): T[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function insertStickyFirst<T extends StickyLike>(
  data: StickyListData<T> | undefined,
  sticky: T,
): StickyListData<T> | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [
      {
        ...first,
        items: [sticky, ...first.items.filter((item) => item.id !== sticky.id)],
      },
      ...rest,
    ],
  };
}

export function patchStickyInData<T extends StickyLike>(
  data: StickyListData<T> | undefined,
  stickyId: string,
  patch: Partial<T>,
): StickyListData<T> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === stickyId)) return page;
    changed = true;
    return {
      ...page,
      items: page.items.map((item) =>
        item.id === stickyId ? { ...item, ...patch } : item,
      ),
    };
  });
  return changed ? { ...data, pages } : data;
}

export function removeStickyFromData<T extends StickyLike>(
  data: StickyListData<T> | undefined,
  stickyId: string,
): StickyListData<T> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((item) => item.id === stickyId)) return page;
    changed = true;
    return {
      ...page,
      items: page.items.filter((item) => item.id !== stickyId),
    };
  });
  return changed ? { ...data, pages } : data;
}

/**
 * Puts the loaded stickies in the given order, keeping each page's size.
 * Ids that are not loaded are ignored; loaded ones left out keep their
 * relative order after the listed ones.
 */
export function reorderStickiesInData<T extends StickyLike>(
  data: StickyListData<T> | undefined,
  orderedIds: readonly string[],
): StickyListData<T> | undefined {
  if (!data) return data;
  const loaded = flattenStickies(data);
  const byId = new Map(loaded.map((item) => [item.id, item]));
  const listed = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
  const listedIds = new Set(listed.map((item) => item.id));
  const ordered = [
    ...listed,
    ...loaded.filter((item) => !listedIds.has(item.id)),
  ];

  let offset = 0;
  const pages = data.pages.map((page) => {
    const items = ordered.slice(offset, offset + page.items.length);
    offset += page.items.length;
    return { ...page, items };
  });
  return { ...data, pages };
}

/** Moves one sticky onto another's slot and returns the new id order. */
export function moveStickyId(
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Markdown and markup that carry no text of their own: list and to-do
// markers, heading and quote marks, HTML-like tags, escapes and entities.
const EMPTY_MARKUP = [
  /<[^>]*>/g,
  /&nbsp;|&#160;/g,
  /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm,
  /^\s*(?:#{1,6}|>)\s*/gm,
  /\\/g,
];

/** True when a sticky's markdown holds no visible text. */
export function isBlankStickyContent(content: string | null | undefined) {
  let text = content ?? "";
  for (const pattern of EMPTY_MARKUP) text = text.replace(pattern, "");
  return text.trim() === "";
}
