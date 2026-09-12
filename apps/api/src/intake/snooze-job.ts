import { inArray, sql } from "drizzle-orm";
import db from "../database";
import { intakeItemTable, projectTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { publishIntakeItemUpdated } from "./events";
import { loadIntakeItems } from "./queries";

// Wakes requests whose snooze ended (B7 §3.8). Reads already treat them as
// pending, so the job only brings the rows, the history and realtime hints
// up to date. It wakes rows of projects with intake off too (data only).

export const INTAKE_SNOOZE_LEASE = "intake-snooze-wakeup";

const BATCH_SIZE = 500;
const MAX_BATCHES = 10;
const LEASE_MS = 5 * 60 * 1000;

async function wakeBatch(): Promise<string[]> {
  // SKIP LOCKED plus the re-checked condition wake each row once, even while
  // a triager holds it or another instance runs.
  const result = await db.execute<{ id: string }>(sql`
    update ${intakeItemTable} as item
    set status = 'pending', snoozed_until = null, updated_at = now()
    where item.id in (
      select due.id from ${intakeItemTable} as due
      where due.status = 'snoozed' and due.snoozed_until <= now()
      order by due.snoozed_until
      limit ${BATCH_SIZE}
      for update skip locked
    )
      and item.status = 'snoozed'
      and item.snoozed_until <= now()
    returning item.id
  `);
  return result.rows.map((row) => row.id);
}

async function publishWoken(ids: readonly string[]): Promise<void> {
  const items = await loadIntakeItems(ids);
  if (items.length === 0) return;
  const projects = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(
      inArray(projectTable.id, [...new Set(items.map((i) => i.projectId))]),
    );
  const workspaceOf = new Map(projects.map((p) => [p.id, p.workspaceId]));
  for (const item of items) {
    const workspaceId = workspaceOf.get(item.projectId);
    if (!workspaceId) continue;
    await publishIntakeItemUpdated({
      item,
      workspaceId,
      userId: null,
      action: "snooze_ended",
      previousStatus: "snoozed",
    });
  }
}

async function runWakeUp(): Promise<{ woken: number; degraded: boolean }> {
  let woken = 0;
  let degraded = false;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    let ids: string[];
    try {
      ids = await wakeBatch();
      await publishWoken(ids);
    } catch (error) {
      console.error("Failed to wake snoozed intake requests", error);
      degraded = true;
      break;
    }
    woken += ids.length;
    if (ids.length < BATCH_SIZE) break;
  }
  return { woken, degraded };
}

export async function wakeSnoozedIntakeItems(): Promise<{
  woken: number;
  degraded: boolean;
}> {
  return withJobLease(
    INTAKE_SNOOZE_LEASE,
    runWakeUp,
    () => ({ woken: 0, degraded: false }),
    LEASE_MS,
  );
}
