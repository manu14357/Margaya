import db from "../database";
import { notificationEmailQueueTable } from "../database/schema";

/** Queues one notification for the user's next batched email. */
export async function enqueueNotificationEmail(
  notificationId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(notificationEmailQueueTable)
    // The app clock, not the database's: the flush compares it with the
    // app's own "now", and the two clocks can drift apart.
    .values({ notificationId, userId, createdAt: new Date() })
    .onConflictDoNothing({
      target: notificationEmailQueueTable.notificationId,
    });
}
