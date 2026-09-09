import { and, eq, inArray, sql } from "drizzle-orm";
import db from "../../database";
import { notificationTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type InboxTab,
  type InboxType,
  type InboxView,
  inboxCondition,
  taskJoinCondition,
} from "../inbox";

export type MarkAllScope = {
  workspaceId: string;
  tab: InboxTab;
  view: InboxView;
  types: InboxType[];
};

/**
 * Without a scope, every notification of the caller (the legacy
 * behavior). With one, only the rows the inbox shows for that workspace,
 * tab, view and type filters.
 */
async function markAllNotificationsAsRead(
  userId: string,
  scope?: MarkAllScope,
) {
  const unread = sql`${notificationTable.isRead} is not true`;
  const where = scope
    ? inArray(
        notificationTable.id,
        db
          .select({ id: notificationTable.id })
          .from(notificationTable)
          .leftJoin(taskTable, taskJoinCondition)
          .where(
            inboxCondition({
              userId,
              workspaceId: scope.workspaceId,
              view: scope.view,
              tab: scope.tab,
              unread: true,
              types: scope.types,
              now: new Date(),
            }),
          ),
      )
    : and(eq(notificationTable.userId, userId), unread);

  const updated = await db
    .update(notificationTable)
    .set({ isRead: true })
    .where(and(eq(notificationTable.userId, userId), unread, where))
    .returning({ id: notificationTable.id });

  if (updated.length > 0) {
    await publishEvent("notification.updated", {
      userId,
      workspaceId: scope?.workspaceId ?? null,
    });
  }

  return { success: true, updatedCount: updated.length };
}

export default markAllNotificationsAsRead;
