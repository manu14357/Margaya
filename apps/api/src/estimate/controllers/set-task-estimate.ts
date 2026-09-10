import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { withAssigneeIds } from "../../task/assignees";
import { applyTaskEstimate, publishEstimateChanges } from "../task-estimate";
import { estimateWrite } from "../write";

async function loadTask(taskId: string) {
  const [task] = await db
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

/**
 * Sets or clears one task's estimate. The point must belong to the active
 * system of the task's project; the route has already checked that the
 * project's estimates feature is on. An unchanged value writes nothing.
 */
async function setTaskEstimate({
  taskId,
  estimatePointId,
  userId,
}: {
  taskId: string;
  estimatePointId: string | null;
  userId: string;
}) {
  const { projectId } = await loadTask(taskId);
  const changes = await estimateWrite((tx) =>
    applyTaskEstimate(tx, {
      projectId,
      taskIds: [taskId],
      pointId: estimatePointId,
      userId,
    }),
  );
  await publishEstimateChanges({ projectId, userId, changes });
  return withAssigneeIds(await loadTask(taskId));
}

export default setTaskEstimate;
