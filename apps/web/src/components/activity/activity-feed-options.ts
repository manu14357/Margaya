import { agentViaOf } from "@/lib/ai/agents";
import type { ActivityFilter, ActivitySort } from "@/store/user-preferences";
import { isCommentActivity } from "./utils";

type FeedItem = {
  id?: string;
  type: string;
  content: string | null;
  createdAt: string;
  eventData?: unknown;
  /** Replies: the top-level comment of their thread. */
  parentId?: string | null;
};

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The task activity feed as the viewer asked for it: all of it, only
 * comments, or only the history lines, newest or oldest first. Rows with
 * the same time keep the order the API gave them. A reply whose top-level
 * comment is in the feed is left out: it shows in that comment's thread
 * (`groupCommentReplies`). Other replies stand on their own.
 */
export function arrangeActivities<T extends FeedItem>(
  items: readonly T[],
  filter: ActivityFilter,
  sort: ActivitySort,
): T[] {
  const kept =
    filter === "all"
      ? [...items]
      : items.filter((item) =>
          filter === "comments"
            ? isCommentActivity(item)
            : filter === "agents"
              ? agentViaOf(item.eventData) !== null
              : !isCommentActivity(item),
        );
  const keptIds = new Set(kept.map((item) => item.id));
  const direction = sort === "newest" ? -1 : 1;
  return kept
    .filter((item) => !(item.parentId && keptIds.has(item.parentId)))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (time(a.item.createdAt) - time(b.item.createdAt)) * direction ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/**
 * Each thread's replies by top-level comment id, oldest first whatever the
 * feed's order: a thread reads as a conversation.
 */
export function groupCommentReplies<T extends FeedItem & { id: string }>(
  items: readonly T[],
): ReadonlyMap<string, T[]> {
  const threads = new Map<string, T[]>();
  for (const item of items) {
    if (!item.parentId || !isCommentActivity(item)) continue;
    const replies = threads.get(item.parentId) ?? [];
    replies.push(item);
    threads.set(item.parentId, replies);
  }
  for (const replies of threads.values()) {
    replies.sort((a, b) => time(a.createdAt) - time(b.createdAt));
  }
  return threads;
}

/** Saves within this long after posting do not count as an edit. */
export const EDITED_THRESHOLD_MS = 60_000;

/** True when a comment was changed meaningfully after it was posted. */
export function isCommentEdited(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): boolean {
  if (!createdAt || !updatedAt) return false;
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created > EDITED_THRESHOLD_MS;
}
