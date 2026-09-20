import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import type {
  InboxFilters,
  InboxView,
  NotificationStateAction,
} from "@/types/notification";

// Query keys of the inbox and the optimistic cache math of its actions
// (B10 §4.8). Views are mutually exclusive: inbox (neither archived nor
// snoozed), snoozed and archived. Counts describe the Inbox view's unread
// rows only.

export type InboxQueryFilters = InboxFilters & { limit: number };

export const inboxQueryKeys = {
  all: () => ["notifications"] as const,
  inboxRoot: () => ["notifications", "inbox"] as const,
  inboxWorkspace: (workspaceId: string) =>
    ["notifications", "inbox", workspaceId] as const,
  inbox: (workspaceId: string, filters: InboxQueryFilters) =>
    ["notifications", "inbox", workspaceId, filters] as const,
  countsRoot: () => ["notifications", "counts"] as const,
  counts: (workspaceId: string) =>
    ["notifications", "counts", workspaceId] as const,
};

/** The row fields the state actions read and write. */
export type InboxRowState = {
  id: string;
  type: string;
  workspaceId?: string | null;
  isRead: boolean | null;
  archivedAt?: string | null;
  snoozedUntil?: string | null;
  resurfacedAt?: string | null;
  isSnoozed: boolean;
};

export type InboxPageLike<R extends InboxRowState> = {
  items: R[];
  nextCursor: string | null;
};

export type CountsLike = { unread: number; unreadMentions: number };

export function isUnread(row: Pick<InboxRowState, "isRead">) {
  return row.isRead !== true;
}

export function viewOfRow(row: InboxRowState): InboxView {
  if (row.archivedAt) return "archived";
  if (row.isSnoozed) return "snoozed";
  return "inbox";
}

/** The row after an action, as the server will write it (§3.8). */
export function applyActionToRow<R extends InboxRowState>(
  row: R,
  change: NotificationStateAction,
  now: Date,
): R {
  const at = now.toISOString();
  switch (change.action) {
    case "read":
      return { ...row, isRead: true };
    case "unread":
      return { ...row, isRead: false };
    case "archive":
      return { ...row, archivedAt: at, snoozedUntil: null, isSnoozed: false };
    case "unarchive":
      return { ...row, archivedAt: null };
    case "snooze":
      return {
        ...row,
        snoozedUntil: change.until,
        archivedAt: null,
        isSnoozed: new Date(change.until).getTime() > now.getTime(),
      };
    case "unsnooze":
      return {
        ...row,
        snoozedUntil: null,
        resurfacedAt: at,
        isSnoozed: false,
      };
  }
}

/** Whether a row still belongs to a list of that view after an action. */
export function rowStaysInView(row: InboxRowState, view: InboxView) {
  return viewOfRow(row) === view;
}

/**
 * Cached pages after an action on one row: the row is updated, or removed
 * when it left the page's view. Rows are never added to other views.
 */
export function applyActionToPages<R extends InboxRowState>(
  data: InfiniteData<InboxPageLike<R>> | undefined,
  id: string,
  change: NotificationStateAction,
  view: InboxView,
  now: Date,
): InfiniteData<InboxPageLike<R>> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((row) => row.id === id)) return page;
    changed = true;
    return {
      ...page,
      items: page.items.flatMap((row) => {
        if (row.id !== id) return [row];
        const next = applyActionToRow(row, change, now);
        return rowStaysInView(next, view) ? [next] : [];
      }),
    };
  });
  return changed ? { ...data, pages } : data;
}

/** How an action moves the Inbox view's unread counts. */
export function countDelta(
  before: InboxRowState,
  change: NotificationStateAction,
  now: Date,
): CountsLike {
  const after = applyActionToRow(before, change, now);
  const weight = (row: InboxRowState) =>
    viewOfRow(row) === "inbox" && isUnread(row) ? 1 : 0;
  const unread = weight(after) - weight(before);
  return {
    unread,
    unreadMentions: before.type === "task_mention" ? unread : 0,
  };
}

export function applyCountDelta<C extends CountsLike>(
  counts: C | undefined,
  delta: CountsLike,
): C | undefined {
  if (!counts) return counts;
  return {
    ...counts,
    unread: Math.max(0, counts.unread + delta.unread),
    unreadMentions: Math.max(0, counts.unreadMentions + delta.unreadMentions),
  };
}

/** The filters part of an inbox query key, when the key is one. */
export function filtersOfKey(key: QueryKey): InboxQueryFilters | null {
  const filters = key[3];
  if (key[0] !== "notifications" || key[1] !== "inbox") return null;
  if (!filters || typeof filters !== "object") return null;
  return filters as InboxQueryFilters;
}

/** Every page's rows, once each (pages can overlap after changes). */
export function flattenInboxPages<R extends { id: string }>(
  data: InfiniteData<{ items: R[] }> | undefined,
): R[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: R[] = [];
  for (const page of data.pages) {
    for (const row of page.items) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}
