import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  webhookDeliveryTable,
  workspaceWebhookTable,
} from "../../database/schema";
import { WEBHOOK_NOT_FOUND, type WebhookRow } from "../access";
import { WEBHOOK_PAUSED } from "../dispatch/attempt";
import { kickWebhookDispatcher } from "../dispatch/dispatcher";
import type { UpdateWebhookInput } from "../schema";
import { toWebhookResponse } from "../serialize";
import { assertWebhookUrlAllowed } from "../url";
import {
  isUniqueViolation,
  normalizeWebhookName,
  WEBHOOK_URL_TAKEN,
  webhookPatterns,
} from "./shared";

/**
 * Changes the endpoint, events or name, or pauses and enables the webhook.
 * Pausing cancels pending deliveries; enabling resets the failure streak
 * and replays nothing. A new URL applies to pending deliveries' next try;
 * new events only to events queued afterwards.
 */
export async function updateWebhook(
  webhook: WebhookRow,
  input: UpdateWebhookInput,
) {
  const set: Partial<typeof workspaceWebhookTable.$inferInsert> = {};
  if (input.name !== undefined) set.name = normalizeWebhookName(input.name);
  if (input.events !== undefined) set.events = webhookPatterns(input.events);
  if (input.url !== undefined) {
    set.url = await assertWebhookUrlAllowed(input.url);
  }

  const now = new Date();
  const pausing = input.isActive === false && webhook.isActive;
  const enabling = input.isActive === true && !webhook.isActive;
  if (pausing) {
    Object.assign(set, {
      isActive: false,
      disabledReason: "manual",
      disabledAt: now,
    });
  }
  if (enabling) {
    Object.assign(set, {
      isActive: true,
      disabledReason: null,
      disabledAt: null,
      failureStreak: 0,
      failingSince: null,
    });
  }

  let updated: WebhookRow | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      const [row] =
        Object.keys(set).length > 0
          ? await tx
              .update(workspaceWebhookTable)
              .set(set)
              .where(eq(workspaceWebhookTable.id, webhook.id))
              .returning()
          : [webhook];
      if (pausing) {
        await tx
          .update(webhookDeliveryTable)
          .set({
            status: "cancelled",
            error: WEBHOOK_PAUSED,
            completedAt: now,
          })
          .where(
            and(
              eq(webhookDeliveryTable.webhookId, webhook.id),
              eq(webhookDeliveryTable.status, "pending"),
            ),
          );
      }
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, { message: WEBHOOK_URL_TAKEN });
    }
    throw error;
  }
  if (!updated) throw new HTTPException(404, { message: WEBHOOK_NOT_FOUND });
  if (enabling) void kickWebhookDispatcher();
  return toWebhookResponse(updated);
}
