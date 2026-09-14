import * as Sentry from "@sentry/node";
import { and, asc, eq, inArray, lt, lte, ne, sql } from "drizzle-orm";
import db from "../../database";
import {
  webhookDeliveryTable,
  workspaceWebhookTable,
} from "../../database/schema";
import {
  attemptDelivery,
  type DeliveryRow,
  DISABLED_AFTER_FAILURES,
  WEBHOOK_PAUSED,
} from "./attempt";
import { ATTEMPT_ERRORS } from "./policy";

// The outbox dispatcher (B13a §3.5). One loop per API instance; claims use
// FOR UPDATE SKIP LOCKED under a two-minute lease, so any number of
// instances share the outbox without Redis or a leader. Delivery is
// at-least-once and unordered. The minute sweep returns crashed claims and
// nudges the loop so retries run even without new traffic.

const CLAIM_BATCH = 20;
const CONCURRENCY = 5;
const LEASE_MS = 2 * 60 * 1000;

let active: Promise<void> | null = null;
let rerun = false;
let stopped = false;

/**
 * Claims up to `limit` due deliveries of active webhooks (pings excluded:
 * the test route sends them itself) and marks them `sending`.
 */
export async function claimDueDeliveries(
  now: Date = new Date(),
  limit: number = CLAIM_BATCH,
): Promise<DeliveryRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: webhookDeliveryTable.id })
      .from(webhookDeliveryTable)
      .innerJoin(
        workspaceWebhookTable,
        and(
          eq(workspaceWebhookTable.id, webhookDeliveryTable.webhookId),
          eq(workspaceWebhookTable.isActive, true),
        ),
      )
      .where(
        and(
          eq(webhookDeliveryTable.status, "pending"),
          lte(webhookDeliveryTable.nextAttemptAt, now),
          ne(webhookDeliveryTable.trigger, "ping"),
        ),
      )
      .orderBy(
        asc(webhookDeliveryTable.nextAttemptAt),
        asc(webhookDeliveryTable.id),
      )
      .limit(limit)
      .for("update", { of: webhookDeliveryTable, skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(webhookDeliveryTable)
      .set({
        status: "sending",
        lockedUntil: new Date(now.getTime() + LEASE_MS),
      })
      .where(
        inArray(
          webhookDeliveryTable.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  });
}

async function inPool<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        if (item !== undefined) await run(item);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * One round: claims due deliveries and sends them, five at a time. Returns
 * how many were claimed. Tests drive this with an explicit clock.
 */
export async function processDueDeliveries(
  now: Date = new Date(),
): Promise<number> {
  const claimed = await claimDueDeliveries(now);
  await inPool(claimed, CONCURRENCY, async (row) => {
    try {
      await attemptDelivery(row, now);
    } catch (error) {
      // The id only. The lease expires and the sweep retries the row.
      console.error(`webhooks: delivery ${row.id} could not be attempted`);
      Sentry.captureException(error, {
        tags: { area: "webhook", deliveryId: row.id },
      });
    }
  });
  return claimed.length;
}

/**
 * Starts this instance's loop unless it is running (then it looks again
 * when done). Resolves when the loop is idle.
 */
export function kickWebhookDispatcher(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (active) {
    rerun = true;
    return active;
  }
  const run = (async () => {
    try {
      do {
        rerun = false;
        while (!stopped && (await processDueDeliveries()) > 0) {
          // Keep claiming until a round finds nothing due.
        }
      } while (rerun && !stopped);
    } catch (error) {
      console.error("webhooks: the dispatcher stopped");
      Sentry.captureException(error, { tags: { area: "webhook" } });
    } finally {
      active = null;
    }
  })();
  active = run;
  return run;
}

/** Allows claiming (again) and looks for due deliveries. */
export function startWebhookDispatcher(): void {
  stopped = false;
  void kickWebhookDispatcher();
}

/** Stops claiming (shutdown); in-flight sends finish or their lease ends. */
export function stopWebhookDispatcher(): void {
  stopped = true;
}

/**
 * The minute sweep: crashed claims go back to pending (at-least-once),
 * pending deliveries of inactive webhooks are cancelled, then the loop is
 * nudged so retries that fell due are sent.
 */
export async function sweepWebhookDeliveries(now: Date = new Date()) {
  const expired = and(
    eq(webhookDeliveryTable.status, "sending"),
    lt(webhookDeliveryTable.lockedUntil, now),
  );
  const requeued = await db
    .update(webhookDeliveryTable)
    .set({ status: "pending", nextAttemptAt: now, lockedUntil: null })
    .where(and(expired, ne(webhookDeliveryTable.trigger, "ping")))
    .returning({ id: webhookDeliveryTable.id });
  // A test request that never finished has nobody left to report to.
  await db
    .update(webhookDeliveryTable)
    .set({
      status: "failed",
      error: ATTEMPT_ERRORS.network,
      lockedUntil: null,
      completedAt: now,
    })
    .where(and(expired, eq(webhookDeliveryTable.trigger, "ping")));

  const cancelled = await db.execute(sql`
    update ${webhookDeliveryTable}
    set "status" = 'cancelled',
        "error" = case when ${workspaceWebhookTable.disabledReason} = 'failures'
          then ${DISABLED_AFTER_FAILURES} else ${WEBHOOK_PAUSED} end,
        "completed_at" = ${now}
    from ${workspaceWebhookTable}
    where ${workspaceWebhookTable.id} = ${webhookDeliveryTable.webhookId}
      and ${webhookDeliveryTable.status} = 'pending'
      and not ${workspaceWebhookTable.isActive}
  `);

  void kickWebhookDispatcher();
  return {
    degraded: false,
    requeued: requeued.length,
    cancelled: cancelled.rowCount ?? 0,
  };
}
