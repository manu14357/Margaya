import { and, eq } from "drizzle-orm";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";

/**
 * Deletes the caller's notifications: all of them (the legacy behavior),
 * or only one workspace's rows, keeping rows that belong to none.
 */
async function clearNotifications(userId: string, workspaceId?: string) {
  const removed = await db
    .delete(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        workspaceId
          ? eq(notificationTable.workspaceId, workspaceId)
          : undefined,
      ),
    )
    .returning({ id: notificationTable.id });

  if (removed.length > 0) {
    await publishEvent("notification.updated", {
      userId,
      workspaceId: workspaceId ?? null,
    });
  }

  return { success: true, updatedCount: removed.length };
}

export default clearNotifications;
