import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import { pageSubscriberTable, type pageTable } from "../database/schema";
import type { Transaction } from "./controllers/shared";

// Who watches a page: its subscribed rows plus its owner, minus muted rows
// (a row with `subscribed = false`), like task subscriptions. Whether a
// watcher may still see the page is checked when a notification is created.

type Writer = Pick<Transaction, "insert">;

/** Subscribes the users; a comment or mention also ends an earlier mute. */
export async function subscribeToPage(
  pageId: string,
  userIds: readonly string[],
  writer: Writer = db,
) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await writer
    .insert(pageSubscriberTable)
    .values(ids.map((userId) => ({ pageId, userId, subscribed: true })))
    .onConflictDoUpdate({
      target: [pageSubscriberTable.pageId, pageSubscriberTable.userId],
      set: { subscribed: true, updatedAt: new Date() },
      setWhere: sql`${pageSubscriberTable.subscribed} = false`,
    });
}

/** Explicitly unwatches: a muted row, which also silences the page's owner. */
export async function muteForPage(pageId: string, userId: string) {
  await db
    .insert(pageSubscriberTable)
    .values({ pageId, userId, subscribed: false })
    .onConflictDoUpdate({
      target: [pageSubscriberTable.pageId, pageSubscriberTable.userId],
      set: { subscribed: false, updatedAt: new Date() },
      setWhere: sql`${pageSubscriberTable.subscribed} = true`,
    });
}

type WatchedPage = Pick<typeof pageTable.$inferSelect, "id" | "ownerId">;

export async function pageSubscriptionOf(page: WatchedPage, userId: string) {
  const [row] = await db
    .select({ subscribed: pageSubscriberTable.subscribed })
    .from(pageSubscriberTable)
    .where(
      and(
        eq(pageSubscriberTable.pageId, page.id),
        eq(pageSubscriberTable.userId, userId),
      ),
    )
    .limit(1);
  return {
    pageId: page.id,
    subscribed: row?.subscribed ?? page.ownerId === userId,
  };
}

/** The page's watchers, before any access or preference check. */
export async function pageWatcherIds(page: WatchedPage): Promise<string[]> {
  const rows = await db
    .select({
      userId: pageSubscriberTable.userId,
      subscribed: pageSubscriberTable.subscribed,
    })
    .from(pageSubscriberTable)
    .where(eq(pageSubscriberTable.pageId, page.id));
  const watchers = new Set(
    rows.filter((row) => row.subscribed).map((row) => row.userId),
  );
  const ownerMuted = rows.some(
    (row) => row.userId === page.ownerId && !row.subscribed,
  );
  if (page.ownerId && !ownerMuted) watchers.add(page.ownerId);
  return [...watchers];
}
