import { sql } from "drizzle-orm";
import db from "../database";
import { publishEvent } from "../events";
import { withJobLease } from "./leader-lock";

// Resurfaces notifications whose snooze ended (B10 §3.9): back in the Inbox
// view, unread, sorted as if they arrived when the snooze ended. Nothing is
// delivered again. The Inbox view already shows a row once its snooze time
// passes, so a late run only delays the unread flag and the move to the top.

export const NOTIFICATION_UNSNOOZE_LEASE = "notification-unsnooze";

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;
// Shorter than the one-minute schedule, so a crashed holder never skips
// more than one run.
const LEASE_MS = 50 * 1000;

async function resurfaceBatch(now: Date) {
  // SKIP LOCKED plus the re-checked WHERE clause resurface each row once,
  // even when two instances run at the same time.
  const result = await db.execute<{
    user_id: string;
    workspace_id: string | null;
  }>(sql`
    update notification as n
    set snoozed_until = null,
        resurfaced_at = n.snoozed_until,
        is_read = false,
        updated_at = now()
    where n.id in (
      select due.id from notification as due
      where due.snoozed_until <= ${now}
        and due.archived_at is null
      order by due.snoozed_until
      limit ${BATCH_SIZE}
      for update skip locked
    )
      and n.snoozed_until <= ${now}
      and n.archived_at is null
    returning n.user_id, n.workspace_id
  `);
  return result.rows;
}

async function runResurface(now: Date): Promise<{ resurfaced: number }> {
  let resurfaced = 0;
  const touched = new Map<
    string,
    { userId: string; workspaceId: string | null }
  >();

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await resurfaceBatch(now);
    resurfaced += rows.length;
    for (const row of rows) {
      touched.set(`${row.user_id}:${row.workspace_id ?? ""}`, {
        userId: row.user_id,
        workspaceId: row.workspace_id,
      });
    }
    if (rows.length < BATCH_SIZE) break;
  }

  for (const { userId, workspaceId } of touched.values()) {
    await publishEvent("notification.updated", { userId, workspaceId });
  }
  return { resurfaced };
}

export async function resurfaceSnoozedNotifications(
  now: Date = new Date(),
): Promise<{ resurfaced: number }> {
  return withJobLease(
    NOTIFICATION_UNSNOOZE_LEASE,
    () => runResurface(now),
    () => ({ resurfaced: 0 }),
    LEASE_MS,
  );
}
