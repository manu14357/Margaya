import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cycleTable, cycleTaskTable, taskTable } from "../../database/schema";
import { removeEntityReferences } from "../../entity-reference/registry";
import { publishEvent } from "../../events";
import {
  type CycleChange,
  publishCycleChanges,
  recordCycleChanges,
} from "./membership";
import { lockCycle } from "./shared";

/**
 * Deletes a cycle for callers with cycle:delete, or for its owner. Tasks stay
 * in the project; their memberships cascade away with the cycle.
 */
async function deleteCycle({
  cycleId,
  userId,
  canDeleteAnyCycle,
}: {
  cycleId: string;
  userId: string;
  canDeleteAnyCycle: boolean;
}) {
  const { cycle, changes } = await db.transaction(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (!canDeleteAnyCycle && cycle.ownerId !== userId) {
      throw new HTTPException(403, {
        message: "Only admins or the cycle's owner can delete it",
      });
    }

    const members = await tx
      .select({ taskId: cycleTaskTable.taskId })
      .from(cycleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
      .where(
        and(
          eq(cycleTaskTable.cycleId, cycleId),
          eq(taskTable.projectId, cycle.projectId),
        ),
      );

    const changes: CycleChange[] = members.map(({ taskId }) => ({
      taskId,
      oldCycleId: cycle.id,
      oldCycleName: cycle.name,
      newCycleId: null,
      newCycleName: null,
      reason: "cycle_deleted",
    }));
    await recordCycleChanges(tx, changes, userId);
    await tx.delete(cycleTable).where(eq(cycleTable.id, cycleId));
    return { cycle, changes };
  });

  await removeEntityReferences("cycle", [cycleId]);

  const removedTaskIds = changes.map((change) => change.taskId);
  await publishEvent("cycle.deleted", {
    cycleId,
    projectId: cycle.projectId,
    userId,
    name: cycle.name,
    taskIds: removedTaskIds,
  });
  await publishCycleChanges({
    projectId: cycle.projectId,
    userId,
    changes,
    announceCycles: false,
  });

  return { id: cycleId, projectId: cycle.projectId, removedTaskIds };
}

export default deleteCycle;
