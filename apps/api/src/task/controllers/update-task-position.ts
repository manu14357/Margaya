import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { TRIAGE_TASK_MESSAGE } from "../../intake/guards";
import { archivedAtAfterStatusWrite, publishArchiveChange } from "../archive";
import { withAssigneeIds } from "../assignees";
import { boardDescription, descriptionDeferred } from "../description-pages";
import {
  completedAtAssignment,
  inTriageColumnSql,
  parseStatusInput,
  taskGroupOf,
} from "../scope";
import { assertValidTaskStatus } from "../validate-task-fields";

// What a drag writes: never a field the board only echoes back, so a stale
// board cannot undo a newer edit made by someone else.
async function updateTaskPosition({
  id,
  position,
  status,
  currentUserId,
}: {
  id: string;
  position: number;
  status: string | undefined;
  currentUserId: string;
}) {
  const [existingTask] = await db
    .select({
      status: taskTable.status,
      projectId: taskTable.projectId,
      archivedAt: taskTable.archivedAt,
      inTriage: sql<boolean>`${inTriageColumnSql}`,
    })
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const nextStatus =
    status !== undefined && status !== existingTask.status ? status : null;

  if (nextStatus !== null) {
    if (parseStatusInput(nextStatus).archive) {
      throw new HTTPException(400, {
        message: "Use POST /task/archive/{id} to archive a task",
      });
    }
    // An intake request leaves triage only by being accepted (B7).
    if (existingTask.inTriage) {
      throw new HTTPException(409, { message: TRIAGE_TASK_MESSAGE });
    }
    await assertValidTaskStatus(nextStatus, existingTask.projectId);
  }

  const column =
    nextStatus === null
      ? null
      : await db.query.columnTable.findFirst({
          where: and(
            eq(columnTable.projectId, existingTask.projectId),
            eq(columnTable.slug, nextStatus),
          ),
        });

  const [updatedTask] = await db
    .update(taskTable)
    .set(
      nextStatus === null
        ? {
            position,
            // Reordering is not an edit: "not updated for N months" project
            // automation must not see every card a drag shifted as fresh.
            updatedAt: sql`${taskTable.updatedAt}`,
          }
        : {
            position,
            status: nextStatus,
            columnId: column?.id ?? null,
            completedAt: completedAtAssignment(
              taskGroupOf(nextStatus, column),
              new Date(),
            ),
            archivedAt: archivedAtAfterStatusWrite(nextStatus),
          },
    )
    .where(eq(taskTable.id, id))
    .returning({
      ...getTableColumns(taskTable),
      description: boardDescription,
      descriptionDeferred,
    });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task position",
    });
  }

  if (nextStatus !== null) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: nextStatus,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });

    if (existingTask.archivedAt !== null) {
      await publishArchiveChange(false, updatedTask, currentUserId);
    }
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

export default updateTaskPosition;
