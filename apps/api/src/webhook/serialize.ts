import { inArray } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";
import { canOpenSecret } from "../utils/secret-box";
import type { WebhookRow } from "./access";
import { type DeliveryRow, deliveryHeaders } from "./dispatch/attempt";
import { WEBHOOK_SECRET_PURPOSE } from "./types";

// Response shapes of webhooks and deliveries. The signing secret is only
// ever added by the create and rotate routes.

export function secretHint(last4: string): string {
  return `whsec_…${last4}`;
}

async function creators(rows: readonly WebhookRow[]) {
  const ids = [
    ...new Set(
      rows.map((row) => row.createdBy).filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await db
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(inArray(userTable.id, ids));
  return new Map(users.map((user) => [user.id, user]));
}

function toWebhook(
  row: WebhookRow,
  creator: { id: string; name: string; image: string | null } | undefined,
  now: Date,
) {
  const inGrace =
    row.previousSecretCiphertext !== null &&
    row.previousSecretExpiresAt !== null &&
    row.previousSecretExpiresAt.getTime() > now.getTime();
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    url: row.url,
    events: row.events,
    isActive: row.isActive,
    disabledReason: row.isActive ? null : (row.disabledReason ?? "manual"),
    disabledAt: row.isActive ? null : row.disabledAt,
    secretHint: secretHint(row.secretLast4),
    secretRotatedAt: row.secretRotatedAt,
    previousSecretExpiresAt: inGrace ? row.previousSecretExpiresAt : null,
    secretStatus: canOpenSecret(WEBHOOK_SECRET_PURPOSE, row.secretCiphertext)
      ? ("ok" as const)
      : ("unreadable" as const),
    health: {
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      failureStreak: row.failureStreak,
      failingSince: row.failingSince,
    },
    createdBy: creator ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function toWebhookResponses(
  rows: readonly WebhookRow[],
  now: Date = new Date(),
) {
  const people = await creators(rows);
  return rows.map((row) =>
    toWebhook(row, row.createdBy ? people.get(row.createdBy) : undefined, now),
  );
}

export async function toWebhookResponse(
  row: WebhookRow,
  now: Date = new Date(),
) {
  const [response] = await toWebhookResponses([row], now);
  if (!response) throw new Error("Webhook serialization failed");
  return response;
}

export function toDeliverySummary(row: DeliveryRow) {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    entityType: row.entityType,
    entityId: row.entityId,
    projectId: row.projectId,
    summary: row.summary,
    status: row.status,
    trigger: row.trigger,
    redeliveryOf: row.redeliveryOf,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.status === "pending" ? row.nextAttemptAt : null,
    responseStatus: row.responseStatus,
    error: row.error,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** The summary plus attempts, the response snippet and the request. */
export function toDeliveryDetail(row: DeliveryRow) {
  const sentAt = row.lastAttemptAt ?? row.createdAt;
  return {
    ...toDeliverySummary(row),
    attempts: row.attempts ?? [],
    responseSnippet: row.responseSnippet,
    requestHeaders: deliveryHeaders({
      event: row.event,
      deliveryId: row.id,
      webhookId: row.webhookId,
      attempt: Math.max(row.attemptCount, 1),
      timestamp: String(Math.floor(sentAt.getTime() / 1000)),
      signature: "v1=…",
    }),
    requestBody: parseBody(row.body),
  };
}
