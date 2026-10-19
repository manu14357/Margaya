import { eq, sql } from "drizzle-orm";
import { withAutomationMarker } from "../../automation-rule/context";
import {
  activityTable,
  cycleTable,
  cycleTaskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import type { Transaction } from "../queries";

/** One task's membership change, recorded as activity and published. */
export type CycleChange = {
  taskId: string;
  oldCycleId: string | null;
  oldCycleName: string | null;
  newCycleId: string | null;
  newCycleName: string | null;
  /** Set when the change came from deleting the old cycle. */
  reason?: "cycle_deleted";
};

const ACTIVITY_BATCH_SIZE = 500;

/**
 * Writes one `cycle_changed` activity per change inside the membership
 * transaction, so history can't go missing when a subscriber fails.
 */
export async function recordCycleChanges(
  tx: Transaction,
  changes: readonly CycleChange[],
  userId: string | null,
  /** Marks history written by a scheduled job, which has no user. */
  automation?: { rule: "cycle_rollover" },
) {
  for (let i = 0; i < changes.length; i += ACTIVITY_BATCH_SIZE) {
    await tx.insert(activityTable).values(
      changes.slice(i, i + ACTIVITY_BATCH_SIZE).map(({ taskId, ...data }) => ({
        taskId,
        type: "cycle_changed",
        userId,
        content: null,
        eventData: automation
          ? { ...data, automation }
          : withAutomationMarker(data),
      })),
    );
  }
}

/** Upserts memberships: a task already in another cycle moves to this one. */
export async function upsertMemberships(
  tx: Transaction,
  cycleId: string,
  taskIds: readonly string[],
  userId: string,
) {
  if (taskIds.length === 0) return;
  const addedAt = new Date();
  await tx
    .insert(cycleTaskTable)
    .values(
      taskIds.map((taskId) => ({ taskId, cycleId, addedBy: userId, addedAt })),
    )
    .onConflictDoUpdate({
      target: cycleTaskTable.taskId,
      set: {
        cycleId: sql`excluded.cycle_id`,
        addedBy: sql`excluded.added_by`,
        addedAt: sql`excluded.added_at`,
      },
    });
}

/**
 * Takes the task out of its cycle, if any, and records the activity. Call it
 * inside the transaction that moves a task to another project, then pass the
 * result to `publishCycleChanges` after the commit.
 */
export async function detachTaskFromCycle(
  tx: Transaction,
  taskId: string,
  userId: string,
): Promise<CycleChange | null> {
  const [removed] = await tx
    .delete(cycleTaskTable)
    .where(eq(cycleTaskTable.taskId, taskId))
    .returning({ cycleId: cycleTaskTable.cycleId });
  if (!removed) return null;

  const [cycle] = await tx
    .select({ name: cycleTable.name })
    .from(cycleTable)
    .where(eq(cycleTable.id, removed.cycleId))
    .limit(1);

  const change: CycleChange = {
    taskId,
    oldCycleId: removed.cycleId,
    oldCycleName: cycle?.name ?? null,
    newCycleId: null,
    newCycleName: null,
  };
  await recordCycleChanges(tx, [change], userId);
  return change;
}

/**
 * Publishes after the commit: one `cycle.tasks_changed` for the cycle lists
 * (skipped for deletes, which announce `cycle.deleted`), then one
 * `task.cycle_changed` per task.
 */
export async function publishCycleChanges({
  projectId,
  userId,
  changes,
  announceCycles = true,
}: {
  projectId: string;
  /** Null for the rollover job. */
  userId: string | null;
  changes: readonly CycleChange[];
  announceCycles?: boolean;
}) {
  if (changes.length === 0) return;

  if (announceCycles) {
    const cycleIds = new Set<string>();
    for (const change of changes) {
      if (change.oldCycleId) cycleIds.add(change.oldCycleId);
      if (change.newCycleId) cycleIds.add(change.newCycleId);
    }
    await publishEvent("cycle.tasks_changed", {
      projectId,
      userId,
      cycleIds: [...cycleIds],
      taskIds: changes.map((change) => change.taskId),
    });
  }

  for (const change of changes) {
    await publishEvent("task.cycle_changed", {
      ...change,
      projectId,
      userId,
      type: "cycle_changed",
    });
  }
}
