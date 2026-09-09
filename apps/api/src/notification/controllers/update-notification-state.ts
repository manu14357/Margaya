import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { notificationResourceAccess } from "../resource-access";
import {
  assertSnoozeWindow,
  type NotificationStateAction,
  notificationStatePatch,
} from "../state";

function ownRow(id: string, userId: string) {
  return and(
    eq(notificationTable.id, id),
    eq(notificationTable.userId, userId),
    notificationResourceAccess(
      userId,
      notificationTable.resourceId,
      notificationTable.resourceType,
    ),
  );
}

/**
 * Read, unread, archive, unarchive, snooze or unsnooze one of the caller's
 * notifications. Another user's id, or a row the access predicate hides,
 * is not found. A no-op answers the row and publishes nothing.
 */
async function updateNotificationState(
  id: string,
  userId: string,
  change: NotificationStateAction,
) {
  const now = new Date();
  if (change.action === "snooze") assertSnoozeWindow(change.until, now);

  const [row] = await db
    .select()
    .from(notificationTable)
    .where(ownRow(id, userId))
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Notification not found" });
  }

  const patch = notificationStatePatch(row, change, now);
  if (!patch) return row;

  const [updated] = await db
    .update(notificationTable)
    .set(patch)
    .where(ownRow(id, userId))
    .returning();
  if (!updated) {
    throw new HTTPException(404, { message: "Notification not found" });
  }

  await publishEvent("notification.updated", {
    userId,
    workspaceId: updated.workspaceId,
  });
  return updated;
}

export default updateNotificationState;
