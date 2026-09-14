import { createId } from "@paralleldrive/cuid2";
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { webhookDeliveryTable } from "../../database/schema";
import type { WebhookRow } from "../access";
import type { DeliveryRow } from "../dispatch/attempt";
import { kickWebhookDispatcher } from "../dispatch/dispatcher";
import { redeliveryBody } from "../envelope";
import type { ListWebhookDeliveriesInput } from "../schema";
import { toDeliveryDetail, toDeliverySummary } from "../serialize";
import { DEFAULT_MAX_ATTEMPTS, type WebhookDeliveryStatus } from "../types";
import { DELIVERY_NOT_FOUND } from "./shared";

export const INVALID_CURSOR = "Invalid cursor";
export const DELIVERY_IN_PROGRESS = "This delivery is still in progress";
export const REDELIVER_PING = "Send a new test instead";
export const REDELIVER_INACTIVE = "Enable the webhook before redelivering";

type Cursor = { createdAt: string; id: string };

export function encodeDeliveryCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/** Throws 400 "Invalid cursor" when malformed. */
export function decodeDeliveryCursor(raw: string): Cursor {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const separator = text.indexOf("|");
  const createdAt = separator > 0 ? text.slice(0, separator) : "";
  const id = separator > 0 ? text.slice(separator + 1) : "";
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new HTTPException(400, { message: INVALID_CURSOR });
  }
  return { createdAt, id };
}

// The creation instant with microseconds, so cursors are exact.
const createdAtKey = sql<string>`to_char(${webhookDeliveryTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page of a webhook's delivery log, newest first. */
export async function listWebhookDeliveries(
  webhook: WebhookRow,
  input: ListWebhookDeliveriesInput,
) {
  const after = input.cursor ? decodeDeliveryCursor(input.cursor) : null;
  const statuses = input.status
    ? ([
        ...new Set(input.status.split(",").map((part) => part.trim())),
      ] as WebhookDeliveryStatus[])
    : null;
  const conditions: (SQL | undefined)[] = [
    eq(webhookDeliveryTable.webhookId, webhook.id),
    statuses ? inArray(webhookDeliveryTable.status, statuses) : undefined,
    input.event ? eq(webhookDeliveryTable.event, input.event) : undefined,
    after
      ? sql`(${webhookDeliveryTable.createdAt}, ${webhookDeliveryTable.id}) < (${after.createdAt}::timestamptz, ${after.id}::text)`
      : undefined,
  ];
  const rows = await db
    .select({
      ...getTableColumns(webhookDeliveryTable),
      cursorKey: createdAtKey,
    })
    .from(webhookDeliveryTable)
    .where(and(...conditions))
    .orderBy(
      desc(webhookDeliveryTable.createdAt),
      desc(webhookDeliveryTable.id),
    )
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ cursorKey: _cursorKey, ...row }) =>
      toDeliverySummary(row),
    ),
    nextCursor:
      rows.length > input.limit && last
        ? encodeDeliveryCursor({ createdAt: last.cursorKey, id: last.id })
        : null,
  };
}

/** A delivery of this webhook, or 404 "Delivery not found". */
async function deliveryOf(
  webhook: WebhookRow,
  deliveryId: string,
): Promise<DeliveryRow> {
  const [row] = await db
    .select()
    .from(webhookDeliveryTable)
    .where(
      and(
        eq(webhookDeliveryTable.id, deliveryId),
        eq(webhookDeliveryTable.webhookId, webhook.id),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: DELIVERY_NOT_FOUND });
  return row;
}

export async function getWebhookDelivery(
  webhook: WebhookRow,
  deliveryId: string,
) {
  return toDeliveryDetail(await deliveryOf(webhook, deliveryId));
}

/**
 * Queues a new delivery with the same body, a new envelope id and
 * `redelivery: true`, linked to the original. History is never rewritten.
 */
export async function redeliverWebhookDelivery(
  webhook: WebhookRow,
  deliveryId: string,
) {
  const original = await deliveryOf(webhook, deliveryId);
  if (original.status === "pending" || original.status === "sending") {
    throw new HTTPException(409, { message: DELIVERY_IN_PROGRESS });
  }
  if (original.trigger === "ping") {
    throw new HTTPException(409, { message: REDELIVER_PING });
  }
  if (!webhook.isActive) {
    throw new HTTPException(409, { message: REDELIVER_INACTIVE });
  }

  const id = createId();
  const [row] = await db
    .insert(webhookDeliveryTable)
    .values({
      id,
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
      event: original.event,
      entityType: original.entityType,
      entityId: original.entityId,
      projectId: original.projectId,
      summary: original.summary,
      body: redeliveryBody(original.body, id),
      status: "pending",
      trigger: "redelivery",
      redeliveryOf: original.id,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new HTTPException(500, { message: "Failed to queue the redelivery" });
  }
  void kickWebhookDispatcher();
  return toDeliverySummary(row);
}
