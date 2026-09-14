import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { webhookDeliveryTable, workspaceTable } from "../../database/schema";
import type { WebhookRow } from "../access";
import { WEBHOOK_PING_EVENT } from "../catalog";
import { attemptDelivery } from "../dispatch/attempt";
import { serializeEnvelope } from "../envelope";
import { toDeliveryDetail } from "../serialize";
import { actorOf } from "../snapshots";

const LEASE_MS = 2 * 60 * 1000;

/**
 * Sends `webhook.ping` once and waits for the answer (at most the request
 * timeout). Allowed while paused or disabled; never changes health.
 */
export async function testWebhook(webhook: WebhookRow, userId: string) {
  const [workspace] = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, webhook.workspaceId))
    .limit(1);
  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const now = new Date();
  const id = createId();
  const { body } = serializeEnvelope({
    deliveryId: id,
    event: WEBHOOK_PING_EVENT,
    occurredAt: now,
    webhookId: webhook.id,
    workspace,
    project: null,
    actor: await actorOf(userId),
    data: { id: webhook.id, name: webhook.name, events: webhook.events },
    changes: null,
  });
  const [row] = await db
    .insert(webhookDeliveryTable)
    .values({
      id,
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
      event: WEBHOOK_PING_EVENT,
      entityType: "webhook",
      entityId: webhook.id,
      summary: WEBHOOK_PING_EVENT,
      body,
      // Claimed at once: the loop never picks up pings.
      status: "sending",
      trigger: "ping",
      maxAttempts: 1,
      nextAttemptAt: now,
      lockedUntil: new Date(now.getTime() + LEASE_MS),
    })
    .returning();
  if (!row) {
    throw new HTTPException(500, { message: "Failed to queue the test" });
  }

  await attemptDelivery(row, now);
  const [finished] = await db
    .select()
    .from(webhookDeliveryTable)
    .where(eq(webhookDeliveryTable.id, id))
    .limit(1);
  return toDeliveryDetail(finished ?? row);
}
