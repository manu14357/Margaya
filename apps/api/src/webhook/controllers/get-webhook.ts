import { and, count, eq } from "drizzle-orm";
import db from "../../database";
import { webhookDeliveryTable } from "../../database/schema";
import type { WebhookRow } from "../access";
import { toWebhookResponse } from "../serialize";

/** The webhook plus how many deliveries wait to be sent or retried. */
export async function getWebhook(webhook: WebhookRow) {
  const [pending] = await db
    .select({ total: count() })
    .from(webhookDeliveryTable)
    .where(
      and(
        eq(webhookDeliveryTable.webhookId, webhook.id),
        eq(webhookDeliveryTable.status, "pending"),
      ),
    );
  return {
    ...(await toWebhookResponse(webhook)),
    pendingDeliveries: pending?.total ?? 0,
  };
}
