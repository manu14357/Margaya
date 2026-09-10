import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { cycleTaskTable } from "../../database/schema";
import { visibleProjectTasks } from "./add-cycle-tasks";
import {
  type CycleChange,
  publishCycleChanges,
  recordCycleChanges,
} from "./membership";
import { lockCycle, uniqueIds } from "./shared";

/** Takes tasks out of a cycle. Allowed for every cycle status, archived included. */
async function removeCycleTasks({
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
    for (const id of ids) {
      const task = byId.get(id);
      if (!task) result.ignored.push(id);
      else if (task.cycleId === cycleId) result.removed.push(id);
      else result.unchanged.push(id);
    }

    if (result.removed.length > 0) {
      await tx
        .delete(cycleTaskTable)
        .where(
          and(
            eq(cycleTaskTable.cycleId, cycleId),
            inArray(cycleTaskTable.taskId, result.removed),
          ),
        );
    }

    const changes: CycleChange[] = result.removed.map((taskId) => ({
      taskId,
      oldCycleId: cycleId,
      oldCycleName: cycle.name,
      newCycleId: null,
      newCycleName: null,
    }));
    await recordCycleChanges(tx, changes, userId);
    return { cycle, result, changes };
  });

  await publishCycleChanges({ projectId: cycle.projectId, userId, changes });
  return result;
}

export default removeCycleTasks;
