import { and, sql } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { inboxScopeCondition, inboxViewCondition } from "../inbox";

/**
 * Unread counts of the Inbox view (neither archived nor snoozed), whatever
 * view or filter the client shows: every type, and mentions alone.
 */
async function getInboxCounts(userId: string, workspaceId: string) {
  const [row] = await db
    .select({
      unread:
        sql<number>`count(*) filter (where ${notificationTable.isRead} is not true)`.mapWith(
          Number,
        ),
      unreadMentions:
        sql<number>`count(*) filter (where ${notificationTable.isRead} is not true and ${notificationTable.type} in ('task_mention', 'page_mention'))`.mapWith(
          Number,
        ),
    })
    .from(notificationTable)
    .where(
      and(
        inboxScopeCondition(userId, workspaceId),
        inboxViewCondition("inbox", new Date()),
      ),
    );

  return { unread: row?.unread ?? 0, unreadMentions: row?.unreadMentions ?? 0 };
}

export default getInboxCounts;
