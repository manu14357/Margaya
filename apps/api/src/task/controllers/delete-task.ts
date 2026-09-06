import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { hardDeleteLiveTask } from "../../trash/hard-delete";
import { trashTask } from "../../trash/task-trash";
import { withAssigneeIds } from "../assignees";
import { inTriageColumnSql } from "../scope";

/**
 * Moves a task and its sub-tasks to the trash (C7). Restoring and permanent
 * deletes go through the trash routes; task.deleted keeps its meaning of
 * "gone from every list". A request still waiting in intake skips the trash
 * and is deleted permanently, like a delete from intake: the trash only
 * holds board tasks.
 */
async function deleteTask(taskId: string, currentUserId: string) {
  const [task] = await db
    .select({ inTriage: inTriageColumnSql })
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), isNull(taskTable.deletedAt)))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  if (task.inTriage) {
    const deleted = await hardDeleteLiveTask(taskId, currentUserId);
    if (!deleted) throw new HTTPException(404, { message: "Task not found" });
    return withAssigneeIds(deleted);
  }
  return trashTask(taskId, currentUserId);
}

export default deleteTask;
