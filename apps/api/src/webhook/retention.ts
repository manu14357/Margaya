import { and, isNotNull, lt, sql } from "drizzle-orm";
import db from "../database";
import {
  webhookDeliveryTable,
  workspaceWebhookTable,
} from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { webhookRetentionDays } from "./settings";

// Hourly, on one instance at a time (K15): the delivery log older than
// WEBHOOK_DELIVERY_RETENTION_DAYS is deleted in bounded batches, and
// previous signing secrets whose grace period ended are cleared.

export const WEBHOOK_RETENTION_LEASE = "webhook-retention";
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WebhookRetentionLimits = { batch: number; budgetMs: number };

export const DEFAULT_WEBHOOK_RETENTION_LIMITS: WebhookRetentionLimits = {
  batch: 5000,
  budgetMs: 2 * 60 * 1000,
};

export type WebhookRetentionOutcome = {
  degraded: boolean;
  deleted: number;
  secretsCleared: number;
};

async function retentionOnce(
  now: Date,
  limits: WebhookRetentionLimits,
): Promise<WebhookRetentionOutcome> {
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - webhookRetentionDays() * DAY_MS);
  let deleted = 0;
  while (Date.now() - startedAt < limits.budgetMs) {
    const result = await db.execute(sql`
      delete from ${webhookDeliveryTable}
      where ${webhookDeliveryTable.id} in (
        select ${webhookDeliveryTable.id} from ${webhookDeliveryTable}
        where ${webhookDeliveryTable.createdAt} < ${cutoff}
        limit ${limits.batch}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < limits.batch) break;
  }

  const cleared = await db
    .update(workspaceWebhookTable)
    .set({ previousSecretCiphertext: null, previousSecretExpiresAt: null })
    .where(
      and(
        isNotNull(workspaceWebhookTable.previousSecretExpiresAt),
        lt(workspaceWebhookTable.previousSecretExpiresAt, now),
      ),
    )
    .returning({ id: workspaceWebhookTable.id });

  if (deleted > 0) {
    console.log(`webhooks: deleted ${deleted} old deliveries`);
  }
  return { degraded: false, deleted, secretsCleared: cleared.length };
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runWebhookRetention(
  now: Date = new Date(),
  limits: WebhookRetentionLimits = DEFAULT_WEBHOOK_RETENTION_LIMITS,
): Promise<WebhookRetentionOutcome> {
  return withJobLease(
    WEBHOOK_RETENTION_LEASE,
    () => retentionOnce(now, limits),
    () => ({ degraded: false, deleted: 0, secretsCleared: 0 }),
    LEASE_MS,
  );
}
