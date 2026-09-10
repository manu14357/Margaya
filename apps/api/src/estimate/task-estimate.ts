import { and, eq, inArray } from "drizzle-orm";
import { activityTable, taskTable } from "../database/schema";
import { publishEvent } from "../events";
import {
  assertTaskEstimatePoint,
  pointSnapshots,
} from "./assert-task-estimate";
import type { PointSnapshot } from "./remap";
import type { EstimateChangeData } from "./types";
import { shareProjectEstimates, type Transaction } from "./write";

/** One task's estimate change, as recorded and published. */
export type TaskEstimateChange = EstimateChangeData & {
  taskId: string;
  title: string;
};

const ACTIVITY_BATCH_SIZE = 500;

/**
 * Writes one `estimate_changed` activity per change inside the transaction
 * that made it, so history can't go missing when a subscriber fails.
 */
export async function recordEstimateChanges(
  tx: Transaction,
  changes: readonly TaskEstimateChange[],
  userId: string,
) {
  for (let i = 0; i < changes.length; i += ACTIVITY_BATCH_SIZE) {
    await tx.insert(activityTable).values(
      changes
        .slice(i, i + ACTIVITY_BATCH_SIZE)
        .map(({ taskId, title: _title, ...eventData }) => ({
          taskId,
          type: "estimate_changed",
          userId,
          content: null,
          eventData,
        })),
    );
  }
}

/** One `task.estimate_changed` per change, after the commit. */
export async function publishEstimateChanges({
  projectId,
  userId,
  changes,
}: {
  projectId: string;
  userId: string;
  changes: readonly TaskEstimateChange[];
}) {
  for (const change of changes) {
    await publishEvent("task.estimate_changed", {
      ...change,
      projectId,
      userId,
      type: "estimate_changed",
    });
  }
}

/** The change that moving from `old` to `next` makes. */
export function estimateChange(
  task: { id: string; title: string },
  old: PointSnapshot | null,
  next: PointSnapshot | null,
  reason?: EstimateChangeData["reason"],
): TaskEstimateChange {
  return {
    taskId: task.id,
    title: task.title,
    oldPointId: old?.id ?? null,
    newPointId: next?.id ?? null,
    oldValue: old?.value ?? null,
    newValue: next?.value ?? null,
    oldType: old?.type ?? null,
    newType: next?.type ?? null,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Sets the estimate of tasks of one project inside the caller's transaction:
 * takes the shared estimate lock, checks the point against the active system
 * (400 otherwise), updates only the tasks whose value differs and records
 * their history. Tasks outside the project are left alone. Publish the
 * returned changes after the commit.
 */
export async function applyTaskEstimate(
  tx: Transaction,
  {
    projectId,
    taskIds,
    pointId,
    userId,
  }: {
    projectId: string;
    taskIds: readonly string[];
    pointId: string | null;
    userId: string;
  },
): Promise<TaskEstimateChange[]> {
  await shareProjectEstimates(tx, projectId);
  const target = pointId
    ? await assertTaskEstimatePoint(projectId, pointId, tx)
    : null;
  if (taskIds.length === 0) return [];

  const current = await tx
    .select({
      id: taskTable.id,
      title: taskTable.title,
      estimatePointId: taskTable.estimatePointId,
    })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, [...taskIds]),
        eq(taskTable.projectId, projectId),
      ),
    )
    .orderBy(taskTable.id)
    .for("update");

  const nextId = target?.id ?? null;
  const changing = current.filter((task) => task.estimatePointId !== nextId);
  if (changing.length === 0) return [];

  const oldSnapshots = await pointSnapshots(tx, [
    ...new Set(
      changing.flatMap((task) =>
        task.estimatePointId ? [task.estimatePointId] : [],
      ),
    ),
  ]);

  await tx
    .update(taskTable)
    .set({ estimatePointId: nextId })
    .where(
      inArray(
        taskTable.id,
        changing.map((task) => task.id),
      ),
    );

  const changes = changing.map((task) =>
    estimateChange(
      task,
      task.estimatePointId
        ? (oldSnapshots.get(task.estimatePointId) ?? null)
        : null,
      target,
    ),
  );
  await recordEstimateChanges(tx, changes, userId);
  return changes;
}
