import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertTasksNotInTriage } from "../../intake/guards";
import { archivedAtStamp, publishArchiveChange } from "../archive";
import { withAssigneeIds } from "../assignees";
import { completedAtAssignment, parseStatusInput, taskGroupOf } from "../scope";
import { assertValidTaskStatus } from "../validate-task-fields";

// An explicit status write. The legacy `archived` status archives the task
// and keeps its column; a real status moves it and restores it when it was
// archived (D7).
async function updateTaskStatus({
  id,
  status,
  currentUserId,
}: {
  id: string;
  status: string;
  currentUserId: string;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // Accepting is the only way out of intake (B7).
  await assertTasksNotInTriage([id]);
  await assertValidTaskStatus(status, existingTask.projectId);

  const input = parseStatusInput(status);
  if (input.archive) {
    const [archivedTask] = await db
      .update(taskTable)
      .set({ archivedAt: archivedAtStamp(new Date()) })
      .where(eq(taskTable.id, id))
      .returning();
    if (!archivedTask) {
      throw new HTTPException(500, {
        message: "Failed to update task status",
      });
    }
    if (!existingTask.archivedAt) {
      await publishArchiveChange(true, archivedTask, currentUserId);
    }
    return withAssigneeIds(archivedTask);
  }

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, existingTask.projectId),
      eq(columnTable.slug, status),
    ),
  });

  const [updatedTask] = await db
    .update(taskTable)
    .set({
      status,
      columnId: column?.id ?? null,
      completedAt: completedAtAssignment(
        taskGroupOf(status, column),
        new Date(),
      ),
      archivedAt: null,
    })
    .where(eq(taskTable.id, id))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task status",
    });
  }

  const restored = existingTask.archivedAt !== null;
  // Restoring a task into the column it already had is not a status change.
  if (!restored || existingTask.status !== status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });
  }
  if (restored) {
    await publishArchiveChange(false, updatedTask, currentUserId);
  }

  await publishEvent("task-relation.refresh", {
    projectId: updatedTask.projectId,
    userId: currentUserId,
  });

  return withAssigneeIds(updatedTask);
}

export default updateTaskStatus;
