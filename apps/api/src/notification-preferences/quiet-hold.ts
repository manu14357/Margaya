import { sql } from "drizzle-orm";
import db from "../database";
import { notificationDeliveryHoldTable } from "../database/schema";
import type { QuietChannel } from "../notification/quiet";

/** Records the channels quiet time held back for one notification. */
export async function holdNotificationDeliveries(
  notificationId: string,
  userId: string,
  channels: readonly QuietChannel[],
): Promise<void> {
  await db
    .insert(notificationDeliveryHoldTable)
    // The app clock, like the email queue: the release compares app times.
    .values({
      notificationId,
      userId,
      channels: [...channels],
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationDeliveryHoldTable.notificationId,
      set: { channels: sql`excluded.channels` },
    });
}
