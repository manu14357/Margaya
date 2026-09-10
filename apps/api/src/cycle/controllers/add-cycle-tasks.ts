import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { cycleTable, cycleTaskTable, taskTable } from "../../database/schema";
import { visibleTaskCondition } from "../../task/scope";
import { projectToday } from "../../utils/timezone";
import type { Transaction } from "../queries";
import {
  type CycleChange,
  publishCycleChanges,
  recordCycleChanges,
  upsertMemberships,
} from "./membership";
import { assertCanReceiveTasks, lockCycle, uniqueIds } from "./shared";

/**
 * The given ids that are visible tasks of the project, each with the cycle it
 * is in now. Anything else (other projects, archived, triage, unknown) is
 * left out, which the callers report as ignored.
 */
export async function visibleProjectTasks(
  tx: Transaction,
  projectId: string,
  taskIds: string[],
) {
  return tx
    .select({
      id: taskTable.id,
      cycleId: cycleTaskTable.cycleId,
      cycleName: cycleTable.name,
    })
    .from(taskTable)
    .leftJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
    .leftJoin(cycleTable, eq(cycleTable.id, cycleTaskTable.cycleId))
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
      ),
    );
}

/**
 * Adds tasks to a draft, upcoming or current cycle. Tasks in another cycle,
 * whatever its status, move here.
 */
async function addCycleTasks({
  cycleId,
  userId,
  taskIds,
}: {
  cycleId: string;
  userId: string;
  taskIds: string[];
}) {
  const ids = uniqueIds(taskIds);

  const { cycle, result, changes } = await db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    assertCanReceiveTasks(cycle, await projectToday(cycle.projectId, tx));

    const found = await visibleProjectTasks(tx, cycle.projectId, ids);
    const byId = new Map(found.map((task) => [task.id, task]));

    const result = {
      cycleId,
      added: [] as string[],
      moved: [] as Array<{ taskId: string; fromCycleId: string }>,
      removed: [] as string[],
      unchanged: [] as string[],
      ignored: [] as string[],
    };
    const changes: CycleChange[] = [];

    for (const id of ids) {
      const task = byId.get(id);
      if (!task) {
        result.ignored.push(id);
      } else if (task.cycleId === cycleId) {
        result.unchanged.push(id);
      } else {
        if (task.cycleId) {
          result.moved.push({ taskId: id, fromCycleId: task.cycleId });
        } else {
          result.added.push(id);
        }
        changes.push({
          taskId: id,
          oldCycleId: task.cycleId,
          oldCycleName: task.cycleName,
          newCycleId: cycleId,
          newCycleName: cycle.name,
        });
      }
    }

    await upsertMemberships(
      tx,
      cycleId,
      changes.map((change) => change.taskId),
      userId,
    );
    await recordCycleChanges(tx, changes, userId);
    return { cycle, result, changes };
  });

  await publishCycleChanges({ projectId: cycle.projectId, userId, changes });
  return result;
}

export default addCycleTasks;
