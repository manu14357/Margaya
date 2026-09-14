import { and, eq, sql } from "drizzle-orm";
import db from "../../database";
import {
  webhookDeliveryTable,
  workspaceWebhookTable,
} from "../../database/schema";
import { openSecret, SecretUnreadableError } from "../../utils/secret-box";
import { WEBHOOK_SECRET_PURPOSE, type WebhookAttempt } from "../types";
import { postWebhook, WebhookSendError } from "./http";
import { notifyWebhookDisabled } from "./notify";
import {
  type AttemptOutcome,
  classifyAttempt,
  nextDelay,
  parseRetryAfter,
  shouldAutoDisable,
  signatureHeader,
} from "./policy";

// One attempt of a claimed delivery (B13a §3.5): sign with a fresh
// timestamp, send, then record the attempt, the delivery's next state and
// the webhook's health in one transaction. Pings never touch health.

export type DeliveryRow = typeof webhookDeliveryTable.$inferSelect;

export const USER_AGENT = "Margaya-Webhooks/1";
export const DISABLED_AFTER_FAILURES =
  "Webhook disabled after repeated failures";
export const WEBHOOK_PAUSED = "Webhook paused";

type SigningSecrets = { secrets: string[] } | { unreadable: true };

/** The current secret, plus the previous one during its grace period. */
export function signingSecrets(
  webhook: {
    secretCiphertext: string;
    previousSecretCiphertext: string | null;
    previousSecretExpiresAt: Date | null;
  },
  now: Date,
): SigningSecrets {
  let current: string;
  try {
    current = openSecret(WEBHOOK_SECRET_PURPOSE, webhook.secretCiphertext);
  } catch (error) {
    if (error instanceof SecretUnreadableError) return { unreadable: true };
    throw error;
  }
  const secrets = [current];
  if (
    webhook.previousSecretCiphertext &&
    webhook.previousSecretExpiresAt &&
    webhook.previousSecretExpiresAt.getTime() > now.getTime()
  ) {
    try {
      secrets.push(
        openSecret(WEBHOOK_SECRET_PURPOSE, webhook.previousSecretCiphertext),
      );
    } catch {
      // An unreadable previous secret only drops the second signature.
    }
  }
  return { secrets };
}

/** The request headers of one attempt (§2.8). */
export function deliveryHeaders(input: {
  event: string;
  deliveryId: string;
  webhookId: string;
  attempt: number;
  timestamp: string;
  signature: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-Margaya-Event": input.event,
    "X-Margaya-Delivery": input.deliveryId,
    "X-Margaya-Webhook-Id": input.webhookId,
    "X-Margaya-Attempt": String(input.attempt),
    "X-Margaya-Timestamp": input.timestamp,
    "X-Margaya-Signature-256": input.signature,
  };
}

type Sent = {
  outcome: AttemptOutcome;
  snippet: string | null;
  durationMs: number | null;
};

async function send(row: DeliveryRow, now: Date): Promise<Sent> {
  const [webhook] = await db
    .select({
      url: workspaceWebhookTable.url,
      secretCiphertext: workspaceWebhookTable.secretCiphertext,
      previousSecretCiphertext: workspaceWebhookTable.previousSecretCiphertext,
      previousSecretExpiresAt: workspaceWebhookTable.previousSecretExpiresAt,
    })
    .from(workspaceWebhookTable)
    .where(eq(workspaceWebhookTable.id, row.webhookId))
    .limit(1);
  if (!webhook) {
    return { outcome: { kind: "network" }, snippet: null, durationMs: null };
  }
  const signing = signingSecrets(webhook, now);
  if ("unreadable" in signing) {
    return { outcome: { kind: "secret" }, snippet: null, durationMs: null };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = deliveryHeaders({
    event: row.event,
    deliveryId: row.id,
    webhookId: row.webhookId,
    attempt: row.attemptCount + 1,
    timestamp,
    signature: signatureHeader(signing.secrets, timestamp, row.body),
  });
  const started = Date.now();
  try {
    const response = await postWebhook(webhook.url, headers, row.body);
    return {
      outcome: {
        kind: "response",
        status: response.status,
        retryAfter: response.retryAfter,
      },
      snippet: response.snippet,
      durationMs: response.durationMs,
    };
  } catch (error) {
    if (error instanceof WebhookSendError) {
      return {
        outcome: { kind: error.kind },
        snippet: null,
        durationMs: Date.now() - started,
      };
    }
    throw error;
  }
}

export type AttemptReport = {
  status: DeliveryRow["status"];
  disabled: boolean;
};

/**
 * Sends a delivery this instance has claimed (status `sending`) and records
 * the result. A row that was reclaimed or deleted meanwhile is left alone.
 */
export async function attemptDelivery(
  row: DeliveryRow,
  now: Date = new Date(),
): Promise<AttemptReport> {
  const sent = await send(row, now);
  const { result, error } = classifyAttempt(sent.outcome);
  const attempt = row.attemptCount + 1;
  const responseStatus =
    sent.outcome.kind === "response" ? sent.outcome.status : null;
  const retryAfter =
    sent.outcome.kind === "response" &&
    (responseStatus === 429 || responseStatus === 503)
      ? parseRetryAfter(sent.outcome.retryAfter, now)
      : null;

  const retrying = result === "retry" && attempt < row.maxAttempts;
  const status: DeliveryRow["status"] =
    result === "succeeded" ? "succeeded" : retrying ? "pending" : "failed";
  const entry: WebhookAttempt = {
    at: now.toISOString(),
    responseStatus,
    error,
    durationMs: sent.durationMs,
  };
  const attempts = [...(row.attempts ?? []), entry].slice(-row.maxAttempts);

  const outcome = await db.transaction(async (tx) => {
    const [recorded] = await tx
      .update(webhookDeliveryTable)
      .set({
        status,
        attemptCount: attempt,
        attempts,
        lastAttemptAt: now,
        responseStatus,
        responseSnippet: sent.snippet,
        error,
        durationMs: sent.durationMs,
        lockedUntil: null,
        nextAttemptAt: retrying
          ? new Date(now.getTime() + nextDelay(attempt, retryAfter))
          : row.nextAttemptAt,
        completedAt: retrying ? null : now,
      })
      .where(
        and(
          eq(webhookDeliveryTable.id, row.id),
          eq(webhookDeliveryTable.status, "sending"),
          eq(webhookDeliveryTable.attemptCount, row.attemptCount),
        ),
      )
      .returning({ id: webhookDeliveryTable.id });
    if (!recorded || row.trigger === "ping" || status === "pending") {
      return { recorded: Boolean(recorded), disabled: false };
    }

    if (status === "succeeded") {
      await tx
        .update(workspaceWebhookTable)
        .set({ lastSuccessAt: now, failureStreak: 0, failingSince: null })
        .where(eq(workspaceWebhookTable.id, row.webhookId));
      return { recorded: true, disabled: false };
    }

    const [health] = await tx
      .update(workspaceWebhookTable)
      .set({
        failureStreak: sql`${workspaceWebhookTable.failureStreak} + 1`,
        failingSince: sql`coalesce(${workspaceWebhookTable.failingSince}, ${now})`,
        lastFailureAt: now,
      })
      .where(eq(workspaceWebhookTable.id, row.webhookId))
      .returning({
        failureStreak: workspaceWebhookTable.failureStreak,
        failingSince: workspaceWebhookTable.failingSince,
        isActive: workspaceWebhookTable.isActive,
      });
    if (
      !health?.isActive ||
      !shouldAutoDisable(health.failureStreak, health.failingSince, now)
    ) {
      return { recorded: true, disabled: false };
    }
    await tx
      .update(workspaceWebhookTable)
      .set({ isActive: false, disabledReason: "failures", disabledAt: now })
      .where(eq(workspaceWebhookTable.id, row.webhookId));
    await tx
      .update(webhookDeliveryTable)
      .set({
        status: "cancelled",
        error: DISABLED_AFTER_FAILURES,
        completedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveryTable.webhookId, row.webhookId),
          eq(webhookDeliveryTable.status, "pending"),
        ),
      );
    return { recorded: true, disabled: true };
  });

  if (outcome.disabled) {
    // The id only: endpoint URLs may carry tokens.
    console.warn(`webhooks: disabled ${row.webhookId} after repeated failures`);
    await notifyWebhookDisabled(row.webhookId);
  }
  return { status, disabled: outcome.disabled };
}
