import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  labelTable,
  projectTable,
  taskTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  applyTaskEstimate,
  publishEstimateChanges,
} from "../../estimate/task-estimate";
import { estimateWrite } from "../../estimate/write";
import { publishEvent } from "../../events";
import {
  assertTasksNotInTriage,
  TRIAGE_TASKS_MESSAGE,
} from "../../intake/guards";
import { removeLabelFromGitea } from "../../plugins/gitea/utils/sync-label-to-gitea";
import { removeLabelFromGitHub } from "../../plugins/github/utils/sync-label-to-github";
import { assertProjectFeatureEnabled } from "../../project/features";
import { trashTasks } from "../../trash/task-trash";
import { publishArchiveChange } from "../archive";
import {
  applyAssigneeChanges,
  type LockedTask,
  lockTasksForAssignees,
  publishAssigneeChanges,
} from "../assignee-writes";
import {
  completedAtAssignment,
  liveTaskCondition,
  parseStatusInput,
  taskGroupOf,
} from "../scope";
import {
  assertValidPriority,
  assertValidTaskStatus,
} from "../validate-task-fields";

type BulkOperation =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "addAssignee"
  | "removeAssignee"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate"
  | "updateEstimate"
  | "archive"
  | "unarchive";

async function bulkUpdateTasks({
  taskIds,
  operation,
  value,
  userId,
}: {
  taskIds: string[];
  operation: BulkOperation;
  value?: string | null;
  userId: string;
}) {
  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      status: taskTable.status,
      priority: taskTable.priority,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      dueDate: taskTable.dueDate,
      archivedAt: taskTable.archivedAt,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    // Trashed tasks read as gone (C7).
    .where(and(inArray(taskTable.id, taskIds), liveTaskCondition));

  if (tasks.length === 0) {
    throw new HTTPException(404, {
      message: "No tasks found",
    });
  }

  const workspaceIds = [...new Set(tasks.map((t) => t.workspaceId))];

  if (workspaceIds.length > 1) {
    throw new HTTPException(400, {
      message: "All tasks must belong to the same workspace",
    });
  }

  const workspaceId = workspaceIds[0];

  if (!workspaceId) {
    throw new HTTPException(400, {
      message: "Could not determine workspace",
    });
  }

  const [membership] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }

  const foundIds = tasks.map((t) => t.id);
  let updatedCount = 0;

  // D7: the legacy "archived" status archives the tasks in their columns.
  const effectiveOperation: BulkOperation =
    operation === "updateStatus" && value && parseStatusInput(value).archive
      ? "archive"
      : operation;

  // Intake requests leave triage only by being accepted (B7).
  if (
    effectiveOperation === "updateStatus" ||
    effectiveOperation === "archive" ||
    effectiveOperation === "unarchive"
  ) {
    await assertTasksNotInTriage(foundIds, TRIAGE_TASKS_MESSAGE);
  }

  switch (effectiveOperation) {
    case "archive":
    case "unarchive": {
      const archive = effectiveOperation === "archive";
      const changed = await db
        .update(taskTable)
        .set({ archivedAt: archive ? new Date() : null })
        .where(
          and(
            inArray(taskTable.id, foundIds),
            archive
              ? isNull(taskTable.archivedAt)
              : isNotNull(taskTable.archivedAt),
          ),
        )
        .returning({
          id: taskTable.id,
          projectId: taskTable.projectId,
          title: taskTable.title,
        });
      updatedCount = changed.length;
      for (const task of changed) {
        await publishArchiveChange(archive, task, userId);
      }
      break;
    }

    case "updateStatus": {
      if (!value) {
        throw new HTTPException(400, { message: "Status value is required" });
      }
      const projectIds = [...new Set(tasks.map((t) => t.projectId))];

      for (const projectId of projectIds) {
        await assertValidTaskStatus(value, projectId);

        const column = await db.query.columnTable.findFirst({
          where: and(
            eq(columnTable.projectId, projectId),
            eq(columnTable.slug, value),
          ),
        });

        const projectTasks = tasks.filter(
          (task) => task.projectId === projectId,
        );
        const projectTaskIds = projectTasks.map((task) => task.id);

        const result = await db
          .update(taskTable)
          .set({
            status: value,
            columnId: column?.id ?? null,
            completedAt: completedAtAssignment(
              taskGroupOf(value, column),
              new Date(),
            ),
            // A status write restores archived tasks.
            archivedAt: null,
          })
          .where(inArray(taskTable.id, projectTaskIds));

        updatedCount += result.rowCount ?? projectTaskIds.length;

        for (const task of projectTasks) {
          const restored = task.archivedAt !== null;
          // Restoring a task into its own column is not a status change.
          if (!restored || task.status !== value) {
            await publishEvent("task.status_changed", {
              taskId: task.id,
              projectId,
              userId,
              oldStatus: task.status,
              newStatus: value,
              title: task.title,
              assigneeId: task.userId,
              type: "status_changed",
            });
          }
          if (restored) await publishArchiveChange(false, task, userId);
        }

        await publishEvent("task-relation.refresh", {
          projectId,
          userId,
        });
      }
      break;
    }

    case "updatePriority": {
      if (!value) {
        throw new HTTPException(400, { message: "Priority value is required" });
      }
      assertValidPriority(value);

      const result = await db
        .update(taskTable)
        .set({ priority: value })
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        await publishEvent("task.priority_changed", {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          oldPriority: task.priority,
          newPriority: value,
          title: task.title,
          type: "priority_changed",
        });
      }
      break;
    }

    case "updateAssignee":
    case "addAssignee":
    case "removeAssignee": {
      const assigneeId = value?.trim() || null;
      if (!assigneeId && operation !== "updateAssignee") {
        throw new HTTPException(400, { message: "Assignee is required" });
      }

      const target = (_task: LockedTask, current: string[]): string[] => {
        if (operation === "addAssignee" && assigneeId) {
          return [...current, assigneeId];
        }
        if (operation === "removeAssignee") {
          return current.filter((id) => id !== assigneeId);
        }
        // updateAssignee: one user replaces everyone; null clears.
        return assigneeId ? [assigneeId] : [];
      };

      // All tasks change in one transaction, or none does (limit, access).
      const changes = await db.transaction(async (tx) =>
        applyAssigneeChanges(
          tx,
          await lockTasksForAssignees(tx, foundIds),
          target,
        ),
      );

      updatedCount = changes.filter((change) => change.changed).length;
      await publishAssigneeChanges({ changes, userId });
      break;
    }

    case "delete": {
      // Bulk delete moves the tasks to the trash too (C7); task.deleted is
      // published for each trashed task, sub-tasks included.
      const trashed = await trashTasks(foundIds, userId);
      const requested = new Set(foundIds);
      updatedCount = trashed.filter((task) => requested.has(task.id)).length;
      break;
    }

    case "addLabel": {
      if (!value) {
        throw new HTTPException(400, { message: "Label ID is required" });
      }

      const label = await db.query.labelTable.findFirst({
        where: eq(labelTable.id, value),
      });

      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }

      if (label.workspaceId && label.workspaceId !== workspaceId) {
        throw new HTTPException(400, {
          message: "Label and tasks must belong to the same workspace",
        });
      }

      for (const task of tasks) {
        const existingAssignment = await db.query.labelTable.findFirst({
          where: and(
            eq(labelTable.name, label.name),
            eq(labelTable.taskId, task.id),
          ),
        });

        if (!existingAssignment) {
          await db
            .insert(labelTable)
            .values({
              name: label.name,
              color: label.color,
              workspaceId: workspaceId,
              taskId: task.id,
            })
            .onConflictDoNothing({
              target: [labelTable.taskId, labelTable.name],
            });
          updatedCount++;

          await publishEvent("task.label_assigned", {
            projectId: task.projectId,
            taskId: task.id,
            userId,
            label: { name: label.name, color: label.color },
            type: "label_assigned",
          });
        }
      }
      break;
    }

    case "removeLabel": {
      if (!value) {
        throw new HTTPException(400, { message: "Label ID is required" });
      }

      const label = await db.query.labelTable.findFirst({
        where: eq(labelTable.id, value),
      });

      if (!label) {
        throw new HTTPException(404, { message: "Label not found" });
      }

      const deletedLabels = await db
        .delete(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, workspaceId),
            eq(labelTable.name, label.name),
            inArray(labelTable.taskId, foundIds),
          ),
        )
        .returning();

      updatedCount = deletedLabels.length;

      for (const deletedLabel of deletedLabels) {
        if (!deletedLabel.taskId) continue;

        removeLabelFromGitHub(deletedLabel.taskId, deletedLabel.name).catch(
          (error) => {
            console.error("Failed to remove label from GitHub:", error);
          },
        );
        removeLabelFromGitea(deletedLabel.taskId, deletedLabel.name).catch(
          (error) => {
            console.error("Failed to remove label from Gitea:", error);
          },
        );

        const task = tasks.find((t) => t.id === deletedLabel.taskId);
        if (!task) continue;

        await publishEvent("task.label_unassigned", {
          label: deletedLabel,
          task,
          projectId: task.projectId,
          taskId: deletedLabel.taskId,
          userId,
          type: "label_unassigned",
        });
      }
      break;
    }

    case "updateDueDate": {
      let parsedDate: Date | null = null;
      if (value) {
        parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new HTTPException(400, {
            message: `Invalid date value "${value}"`,
          });
        }
      }

      const result = await db
        .update(taskTable)
        .set({ dueDate: parsedDate })
        .where(inArray(taskTable.id, foundIds));

      updatedCount = result.rowCount ?? foundIds.length;

      for (const task of tasks) {
        await publishEvent("task.due_date_changed", {
          taskId: task.id,
          projectId: task.projectId,
          userId,
          oldDueDate: task.dueDate,
          newDueDate: parsedDate,
          title: task.title,
          type: "due_date_changed",
        });
      }
      break;
    }

    case "updateEstimate": {
      // Estimate values belong to one project's system.
      const projectIds = [...new Set(tasks.map((task) => task.projectId))];
      const [projectId] = projectIds;
      if (!projectId || projectIds.length > 1) {
        throw new HTTPException(400, {
          message:
            "All tasks must belong to the same project to set an estimate",
        });
      }
      await assertProjectFeatureEnabled(projectId, "estimates");

      const changes = await estimateWrite((tx) =>
        applyTaskEstimate(tx, {
          projectId,
          taskIds: foundIds,
          pointId: value?.trim() || null,
          userId,
        }),
      );
      updatedCount = changes.length;
      await publishEstimateChanges({ projectId, userId, changes });
      break;
    }

    default: {
      throw new HTTPException(400, {
        message: `Unknown operation "${operation}"`,
      });
    }
  }

  return { success: true, updatedCount };
}

export default bulkUpdateTasks;
