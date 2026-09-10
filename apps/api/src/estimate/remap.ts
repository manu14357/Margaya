import { and, eq, sql } from "drizzle-orm";
import { activityTable, taskTable } from "../database/schema";
import type {
  EstimateChangeData,
  EstimateChangeReason,
  EstimateType,
} from "./types";
import type { Transaction } from "./write";

/** A point as the activity history remembers it. */
export type PointSnapshot = {
  id: string;
  value: string;
  type: EstimateType;
};

export type RemapCounts = {
  movedTaskCount: number;
  clearedTaskCount: number;
};

/**
 * Moves every task of the project from one point to another, or clears it
 * (`to` null), inside the caller's transaction. The history rows are written
 * first, one `estimate_changed` activity per task in a single INSERT …
 * SELECT, so a board of any size costs two statements and no task is loaded
 * into memory. Returns how many tasks changed.
 */
export async function remapPoint(
  tx: Transaction,
  {
    projectId,
    userId,
    from,
    to,
    reason,
  }: {
    projectId: string;
    userId: string;
    from: PointSnapshot;
    to: PointSnapshot | null;
    reason: EstimateChangeReason;
  },
): Promise<number> {
  const onPoint = and(
    eq(taskTable.projectId, projectId),
    eq(taskTable.estimatePointId, from.id),
  );
  const eventData: EstimateChangeData = {
    oldPointId: from.id,
    newPointId: to?.id ?? null,
    oldValue: from.value,
    newValue: to?.value ?? null,
    oldType: from.type,
    newType: to?.type ?? null,
    reason,
  };

  await tx.execute(sql`
    insert into ${activityTable} ("id", "task_id", "type", "user_id", "content", "event_data")
    select gen_random_uuid()::text, ${taskTable.id}, 'estimate_changed', ${userId}, null, ${JSON.stringify(eventData)}::jsonb
    from ${taskTable}
    where ${onPoint}
  `);

  const result = await tx
    .update(taskTable)
    .set({ estimatePointId: to?.id ?? null })
    .where(onPoint);
  return result.rowCount ?? 0;
}

/**
 * Applies a whole remap plan (each source point at most once) and sums what
 * moved to another point and what was cleared.
 */
export async function remapPoints(
  tx: Transaction,
  {
    projectId,
    userId,
    plan,
    reason,
  }: {
    projectId: string;
    userId: string;
    plan: ReadonlyArray<{ from: PointSnapshot; to: PointSnapshot | null }>;
    reason: EstimateChangeReason;
  },
): Promise<RemapCounts> {
  const counts: RemapCounts = { movedTaskCount: 0, clearedTaskCount: 0 };
  for (const { from, to } of plan) {
    const changed = await remapPoint(tx, {
      projectId,
      userId,
      from,
      to,
      reason,
    });
    if (to) counts.movedTaskCount += changed;
    else counts.clearedTaskCount += changed;
  }
  return counts;
}
