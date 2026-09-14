import { eq } from "drizzle-orm";
import db from "../../database";
import { workspaceWebhookTable } from "../../database/schema";
import type { WebhookRow } from "../access";

/** Deletes the webhook; its pending deliveries and log go with it. */
export async function deleteWebhook(webhook: WebhookRow) {
  await db
    .delete(workspaceWebhookTable)
    .where(eq(workspaceWebhookTable.id, webhook.id));
  return { id: webhook.id };
}
