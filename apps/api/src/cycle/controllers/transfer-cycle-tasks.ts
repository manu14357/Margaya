import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cycleTable, cycleTaskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { projectToday } from "../../utils/timezone";
import { deriveCycleStatus } from "../dates";
import { pendingScopeTaskIds, type Transaction } from "../queries";
import {
  type CycleChange,
  publishCycleChanges,
  recordCycleChanges,
} from "./membership";
import { CYCLE_NOT_FOUND, type CycleRecord, computeLiveReport } from "./shared";

/**
 * Inside a transaction that holds both cycle rows: freezes the source's
 * progress report (the first freeze wins), moves its unfinished tasks to the
 * target and records one history row per task. The caller publishes the
 * returned changes after the commit. A null user is the rollover job.
 */
export async function moveUnfinishedTasks(
  tx: Transaction,
  {
    source,
    target,
    workspaceId,
    today,
    userId,
  }: {
    source: CycleRecord;
    target: CycleRecord;
    workspaceId: string;
    today: string;
    userId: string | null;
  },
): Promise<{ frozeNow: boolean; changes: CycleChange[] }> {
  let frozeNow = false;
  if (!source.progressSnapshot) {
    const report = await computeLiveReport(tx, source, workspaceId, today);
    await tx
      .update(cycleTable)
      .set({
        progressSnapshot: { ...report, frozenAt: new Date().toISOString() },
      })
      .where(eq(cycleTable.id, source.id));
    frozeNow = true;
  }

  const pendingIds = await pendingScopeTaskIds(tx, source.id);
  // Re-checking the source cycle in the WHERE skips a task that moved away
  // concurrently after the ids were read.
  const moved =
    pendingIds.length === 0
      ? []
      : await tx
          .update(cycleTaskTable)
          .set({ cycleId: target.id, addedBy: userId, addedAt: new Date() })
          .where(
            and(
              eq(cycleTaskTable.cycleId, source.id),
              inArray(cycleTaskTable.taskId, pendingIds),
            ),
          )
          .returning({ taskId: cycleTaskTable.taskId });

  const changes: CycleChange[] = moved.map(({ taskId }) => ({
    taskId,
    oldCycleId: source.id,
    oldCycleName: source.name,
    newCycleId: target.id,
    newCycleName: target.name,
  }));
  await recordCycleChanges(
    tx,
    changes,
    userId,
    userId === null ? { rule: "cycle_rollover" } : undefined,
  );
  return { frozeNow, changes };
}

/**
 * Moves a completed cycle's unfinished tasks (backlog, not started, started)
 * to a draft, upcoming or current cycle of the same project. The source's
 * progress report is frozen first; the first freeze wins. Completed and
 * cancelled tasks stay with the source.
 */
async function transferCycleTasks({
  sourceCycleId,
  targetCycleId,
  workspaceId,
  userId,
}: {
  sourceCycleId: string;
  targetCycleId: string;
  workspaceId: string;
  userId: string;
}) {
  if (sourceCycleId === targetCycleId) {
    throw new HTTPException(400, {
      message: "A cycle can't transfer tasks to itself",
    });
  }

  const outcome = await db.transaction(async (tx) => {
    // Lock both rows in id order so opposite transfers can't deadlock.
    const locked = await tx
      .select()
      .from(cycleTable)
      .where(inArray(cycleTable.id, [sourceCycleId, targetCycleId]))
      .orderBy(asc(cycleTable.id))
      .for("update");
    const source = locked.find((cycle) => cycle.id === sourceCycleId);
    if (!source) throw new HTTPException(404, { message: CYCLE_NOT_FOUND });

    const today = await projectToday(source.projectId, tx);
    if (source.archivedAt || deriveCycleStatus(source, today) !== "completed") {
      throw new HTTPException(409, {
        message: "Only completed cycles can transfer tasks",
      });
    }

    const target = locked.find((cycle) => cycle.id === targetCycleId);
    if (!target || target.projectId !== source.projectId) {
      throw new HTTPException(404, { message: "Target cycle not found" });
    }
    if (target.archivedAt || deriveCycleStatus(target, today) === "completed") {
      throw new HTTPException(409, {
        message: "Tasks can only move to an active, upcoming or draft cycle",
      });
    }

    const { frozeNow, changes } = await moveUnfinishedTasks(tx, {
      source,
      target,
      workspaceId,
      today,
      userId,
    });

    return { projectId: source.projectId, frozeNow, changes };
  });

  if (outcome.frozeNow) {
    await publishEvent("cycle.updated", {
      cycleId: sourceCycleId,
      projectId: outcome.projectId,
      userId,
      changes: ["progressSnapshot"],
    });
  }
  await publishCycleChanges({
    projectId: outcome.projectId,
    userId,
    changes: outcome.changes,
  });

  return {
    sourceCycleId,
    targetCycleId,
    movedTaskIds: outcome.changes.map((change) => change.taskId),
    isFrozen: true,
  };
}

export default transferCycleTasks;
