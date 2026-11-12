import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type AiAssistInput, nextAiProvenance } from "../../ai/provenance";
import db from "../../database";
import {
  columnTable,
  taskReminderSentTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { TRIAGE_TASK_MESSAGE } from "../../intake/guards";
import { syncMentions } from "../../mention/sync";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { recordDescriptionVersion } from "../../task-description-version/track";
import {
  archivedAtAfterStatusWrite,
  archivedAtStamp,
  publishArchiveChange,
} from "../archive";
import { resolveFullUpdateAssignees } from "../assignee-rules";
import {
  type AssigneeChange,
  changeTaskAssignees,
  publishAssigneeChanges,
} from "../assignee-writes";
import { assigneesOfTask } from "../assignees";
import { boardDescription, descriptionDeferred } from "../description-pages";
import {
  completedAtAssignment,
  inTriageColumnSql,
  parseStatusInput,
  taskGroupOf,
} from "../scope";
import { assertValidTaskStatus } from "../validate-task-fields";
import { assertTaskPosition } from "./next-task-position";

/** Two nulls are equal; dates compare by instant. */
function sameInstant(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

async function updateTask(
  id: string,
  title: string,
  status: string,
  startDate: Date | undefined,
  dueDate: Date | undefined,
  projectId: string,
  description: string | undefined,
  priority: string,
  position: number,
  userId?: string,
  currentUserId?: string,
  assigneeIds?: string[],
  ai?: { workspaceId?: string; assist?: AiAssistInput },
) {
  assertTaskPosition(position);

  const [existingTask] = await db
    .select({
      id: taskTable.id,
      description:
        description === undefined ? sql<null>`null` : taskTable.description,
      status: taskTable.status,
      projectId: taskTable.projectId,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      archivedAt: taskTable.archivedAt,
      updatedAt: taskTable.updatedAt,
      aiProvenance: taskTable.aiProvenance,
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

  if (projectId !== existingTask.projectId) {
    throw new HTTPException(400, {
      message: "Use the task move endpoint to move tasks between projects",
    });
  }

  // An intake request leaves triage only by being accepted (B7). Echoing
  // its triage status keeps it there, so full edits of other fields work.
  if (existingTask.inTriage) {
    if (status !== existingTask.status) {
      throw new HTTPException(409, { message: TRIAGE_TASK_MESSAGE });
    }
  } else {
    await assertValidTaskStatus(status, projectId);
  }

  // D7: the legacy "archived" status archives the task in its column. A full
  // update echoes the task back, so a real status restores an archived task
  // only when it differs from the current one; echoing it keeps the archive.
  const statusInput = parseStatusInput(status);
  const column = statusInput.archive
    ? null
    : await db.query.columnTable.findFirst({
        where: and(
          eq(columnTable.projectId, projectId),
          eq(columnTable.slug, status),
        ),
      });
  const statusWrite = statusInput.archive
    ? { archivedAt: archivedAtStamp(new Date()) }
    : {
        status,
        columnId: column?.id ?? null,
        completedAt: completedAtAssignment(
          taskGroupOf(status, column),
          new Date(),
        ),
        archivedAt: archivedAtAfterStatusWrite(status),
      };

  const newStartDate = startDate || null;
  const newDueDate = dueDate || null;
  const dueDateChanged = !sameInstant(existingTask.dueDate, newDueDate);
  // Clients echo a missing description as "", which is no change.
  const descriptionChanged =
    description !== undefined &&
    (existingTask.description ?? "") !== description;
  const aiProvenance = currentUserId
    ? await nextAiProvenance({
        existing: existingTask.aiProvenance,
        changed: descriptionChanged,
        workspaceId: ai?.workspaceId,
        userId: currentUserId,
        assist: ai?.assist,
      })
    : undefined;

  // The fields and the assignees change together or not at all. The UPDATE
  // locks the task row, so the assignees read after it are current.
  const { updatedTask, change, currentAssigneeIds } = await db.transaction(
    async (tx) => {
      // A new due date must trigger fresh reminders.
      if (dueDateChanged) {
        await tx
          .delete(taskReminderSentTable)
          .where(eq(taskReminderSentTable.taskId, id));
      }
      const [updatedTask] = await tx
        .update(taskTable)
        .set({
          title,
          ...statusWrite,
          startDate: startDate || null,
          dueDate: dueDate || null,
          projectId,
          description,
          priority,
          position,
          ...(aiProvenance !== undefined ? { aiProvenance } : {}),
        })
        .where(eq(taskTable.id, id))
        .returning({
          ...getTableColumns(taskTable),
          description: boardDescription,
          descriptionDeferred,
        });

      if (!updatedTask) {
        throw new HTTPException(500, {
          message: "Failed to update task",
        });
      }

      const current = await assigneesOfTask(id, tx);
      const target = resolveFullUpdateAssignees({
        assigneeIds,
        userId,
        current,
      });
      const change: AssigneeChange | null =
        target === null
          ? null
          : await changeTaskAssignees(tx, id, () => target);

      return { updatedTask, change, currentAssigneeIds: current };
    },
  );

  const task = {
    ...updatedTask,
    userId: change ? change.firstAfter : updatedTask.userId,
    assigneeIds: change ? change.after : currentAssigneeIds,
  };

  if (existingTask.status !== task.status) {
    await publishEvent("task.status_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: task.status,
      title: task.title,
      assigneeId: task.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: task.projectId,
      userId: currentUserId,
    });
  }

  if ((existingTask.archivedAt === null) !== (task.archivedAt === null)) {
    await publishArchiveChange(
      task.archivedAt !== null,
      task,
      currentUserId ?? null,
    );
  }

  await publishEvent("task.updated", {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    userId: currentUserId,
  });

  if (change) {
    await publishAssigneeChanges({ changes: [change], userId: currentUserId });
  }

  // Full updates (the start-date picker, MCP, API clients) are audited like
  // the single-field routes.
  if (!sameInstant(existingTask.startDate, newStartDate)) {
    await publishEvent("task.start_date_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      oldStartDate: existingTask.startDate,
      newStartDate,
      title: task.title,
      type: "start_date_changed",
    });
  }

  if (dueDateChanged) {
    await publishEvent("task.due_date_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      oldDueDate: existingTask.dueDate,
      newDueDate,
      title: task.title,
      type: "due_date_changed",
    });
  }

  if (description !== undefined && existingTask.description !== description) {
    // Clients echo a missing description as "", which is no change.
    if ((existingTask.description ?? "") !== description) {
      await recordDescriptionVersion({
        taskId: task.id,
        previous: existingTask.description,
        previousSavedAt: existingTask.updatedAt,
        next: description,
        authorId: currentUserId ?? null,
      }).catch((error) => {
        console.error("Failed to record a description version:", error);
      });

      await publishEvent("task.description_changed", {
        taskId: task.id,
        projectId: task.projectId,
        userId: currentUserId,
        oldDescription: existingTask.description,
        newDescription: description,
        type: "description_changed",
      });

      // The create-modal draft path saves descriptions here, so mentions
      // are synced (and newly mentioned members notified) like the
      // description route.
      await syncMentions({
        taskId: task.id,
        commentId: null,
        previous: existingTask.description,
        next: description,
        actorId: currentUserId ?? null,
        mode: "interactive",
      });
    }

    deleteOrphanedAssets(existingTask.description, description, {
      taskId: id,
    }).catch(() => {});
  }

  return task;
}

export default updateTask;
