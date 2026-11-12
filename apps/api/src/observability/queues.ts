import { and, count, eq, gte } from "drizzle-orm";
import db from "../database";
import {
  notificationEmailQueueTable,
  webhookDeliveryTable,
} from "../database/schema";

// Backlogs of the PostgreSQL-backed queues. They are instance-wide (every
// replica reads the same tables), so a dashboard should not sum them.

export type QueueBacklogs = {
  /** Notification emails waiting for their batch window or a retry. */
  emailBacklog: number;
  /** Webhook deliveries not yet delivered or given up on. */
  webhookPending: number;
  /** Webhook deliveries that used up their retries in the last 24 hours. */
  webhookFailed24h: number;
};

export async function readQueueBacklogs(
  now = new Date(),
): Promise<QueueBacklogs> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [email, pending, failed] = await Promise.all([
    db.select({ value: count() }).from(notificationEmailQueueTable),
    db
      .select({ value: count() })
      .from(webhookDeliveryTable)
      .where(eq(webhookDeliveryTable.status, "pending")),
    db
      .select({ value: count() })
      .from(webhookDeliveryTable)
      .where(
        and(
          eq(webhookDeliveryTable.status, "failed"),
          gte(webhookDeliveryTable.createdAt, since),
        ),
      ),
  ]);
  return {
    emailBacklog: Number(email[0]?.value ?? 0),
    webhookPending: Number(pending[0]?.value ?? 0),
    webhookFailed24h: Number(failed[0]?.value ?? 0),
  };
}
