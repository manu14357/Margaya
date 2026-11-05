import { and, desc, eq, gte, sql } from "drizzle-orm";
import db from "../../database";
import {
  webhookDeliveryTable,
  workspaceTable,
  workspaceWebhookTable,
} from "../../database/schema";

const RECENT_DAYS = 7;
const MAX_ITEMS = 20;

/**
 * Webhook deliveries that used up their retries in the last week, across all
 * workspaces. Never the destination URL, body or response: those can hold
 * tokens and workspace data, and the workspace's own delivery log shows them.
 */
export async function listRecentDeliveryFailures() {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const items = await db
    .select({
      id: webhookDeliveryTable.id,
      workspaceName: workspaceTable.name,
      webhookName: workspaceWebhookTable.name,
      event: webhookDeliveryTable.event,
      error: webhookDeliveryTable.error,
      responseStatus: webhookDeliveryTable.responseStatus,
      attemptCount: webhookDeliveryTable.attemptCount,
      failedAt:
        sql<Date>`coalesce(${webhookDeliveryTable.completedAt}, ${webhookDeliveryTable.lastAttemptAt}, ${webhookDeliveryTable.createdAt})`.mapWith(
          webhookDeliveryTable.createdAt,
        ),
    })
    .from(webhookDeliveryTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, webhookDeliveryTable.workspaceId),
    )
    .innerJoin(
      workspaceWebhookTable,
      eq(workspaceWebhookTable.id, webhookDeliveryTable.webhookId),
    )
    .where(
      and(
        eq(webhookDeliveryTable.status, "failed"),
        gte(webhookDeliveryTable.createdAt, since),
      ),
    )
    .orderBy(
      desc(webhookDeliveryTable.createdAt),
      desc(webhookDeliveryTable.id),
    )
    .limit(MAX_ITEMS);

  return { items };
}
