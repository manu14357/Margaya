import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { withAssigneeIds } from "../assignees";
import { liveTaskCondition } from "../scope";

/**
 * Marks a task as a milestone or back. Its stored dates stay as they are, so
 * the change undoes cleanly; the timeline reads a milestone's due date.
 */
async function updateTaskMilestone({
  id,
  isMilestone,
  currentUserId,
}: {
  id: string;
  isMilestone: boolean;
  currentUserId: string;
}) {
  const [existingTask] = await db
    .select()
    .from(taskTable)
    .where(and(eq(taskTable.id, id), liveTaskCondition))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  if (existingTask.isMilestone === isMilestone) {
    return withAssigneeIds(existingTask);
  }

  const [updatedTask] = await db
    .update(taskTable)
    .set({ isMilestone })
    .where(eq(taskTable.id, id))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update the task",
    });
  }

  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });

  return withAssigneeIds(updatedTask);
}

export default updateTaskMilestone;
