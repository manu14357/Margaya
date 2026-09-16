import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import db from "../../../database";
import {
  columnTable,
  integrationTable,
  taskTable,
} from "../../../database/schema";
import {
  archivedAtAfterStatusWrite,
  publishArchiveChange,
} from "../../../task/archive";
import {
  completedAtAssignment,
  parseStatusInput,
  taskGroupOf,
} from "../../../task/scope";
import { type GitHubConfig, hasVerifiedGitHubBinding } from "../config";

export type TaskRow = InferSelectModel<typeof taskTable>;

export type UpdateTaskStatusResult =
  | { applied: false }
  | { applied: true; before: TaskRow; after: TaskRow };

// "archived" is the legacy alias (D7): it archives the task in its column.
const NON_COLUMN_STATUSES = new Set(["planned", "archived"]);

export async function findTaskByNumber(projectId: string, taskNumber: number) {
  return db.query.taskTable.findFirst({
    where: and(
      eq(taskTable.projectId, projectId),
      eq(taskTable.number, taskNumber),
      isNull(taskTable.deletedAt),
    ),
  });
}

export async function findTaskById(taskId: string) {
  return db.query.taskTable.findFirst({
    where: and(eq(taskTable.id, taskId), isNull(taskTable.deletedAt)),
  });
}

export async function updateTaskStatus(
  taskId: string,
  newStatus: string,
): Promise<UpdateTaskStatusResult> {
  const task = await db.query.taskTable.findFirst({
    where: and(eq(taskTable.id, taskId), isNull(taskTable.deletedAt)),
  });

  if (!task) {
    return { applied: false };
  }

  if (parseStatusInput(newStatus).archive) {
    if (!task.archivedAt) {
      await db
        .update(taskTable)
        .set({ archivedAt: new Date() })
        .where(eq(taskTable.id, taskId));
    }
    const archived = await db.query.taskTable.findFirst({
      where: and(eq(taskTable.id, taskId), isNull(taskTable.deletedAt)),
    });
    if (!archived) return { applied: false };
    if (!task.archivedAt) await publishArchiveChange(true, archived, null);
    return { applied: true, before: task, after: archived };
  }

  let columnId: string | null = null;

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, task.projectId),
      eq(columnTable.slug, newStatus),
    ),
  });

  if (column) {
    columnId = column.id;
  } else if (!NON_COLUMN_STATUSES.has(newStatus)) {
    console.warn(
      `[GitHub] Skipping status update for task ${taskId}: column "${newStatus}" not found in project ${task.projectId}`,
    );
    return { applied: false };
  }

  await db
    .update(taskTable)
    .set({
      status: newStatus,
      columnId,
      completedAt: completedAtAssignment(
        taskGroupOf(newStatus, column),
        new Date(),
      ),
      // Re-applying the same status (every label event does) keeps an
      // archived task archived; moving it elsewhere restores it.
      archivedAt: archivedAtAfterStatusWrite(newStatus),
    })
    .where(eq(taskTable.id, taskId));

  const after = await db.query.taskTable.findFirst({
    where: and(eq(taskTable.id, taskId), isNull(taskTable.deletedAt)),
  });

  if (!after) {
    return { applied: false };
  }

  if (task.archivedAt && !after.archivedAt) {
    await publishArchiveChange(false, after, null);
  }

  return { applied: true, before: task, after };
}

export async function isTaskInFinalState(task: {
  projectId: string;
  status: string;
  columnId: string | null;
}): Promise<boolean> {
  if (task.columnId) {
    const columnById = await db.query.columnTable.findFirst({
      where: and(
        eq(columnTable.id, task.columnId),
        eq(columnTable.projectId, task.projectId),
      ),
    });

    if (columnById) {
      return columnById.isFinal;
    }
  }

  const columnByStatus = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, task.projectId),
      eq(columnTable.slug, task.status),
    ),
  });

  if (columnByStatus) {
    return columnByStatus.isFinal;
  }

  return task.status === "done";
}

export async function getIntegrationWithProject(integrationId: string) {
  return db.query.integrationTable.findFirst({
    where: eq(integrationTable.id, integrationId),
    with: {
      project: true,
    },
  });
}

export type GitHubWebhookSource = {
  installation?: { id: number };
  repository: { id: number };
};

export async function findAllIntegrationsByRepo(source: GitHubWebhookSource) {
  const installationId = source.installation?.id;
  const repositoryId = source.repository.id;
  if (
    !Number.isSafeInteger(installationId) ||
    !Number.isSafeInteger(repositoryId)
  )
    return [];
  const integrations = await db.query.integrationTable.findMany({
    where: and(
      eq(integrationTable.type, "github"),
      eq(integrationTable.isActive, true),
    ),
    with: { project: true },
  });
  return integrations.filter((integration) => {
    // A trashed project's integrations stay quiet (C7).
    if (integration.project?.deletedAt) return false;
    try {
      const config = JSON.parse(integration.config) as GitHubConfig;
      return (
        hasVerifiedGitHubBinding(config) &&
        config.installationId === installationId &&
        config.repositoryId === repositoryId
      );
    } catch {
      return false;
    }
  });
}
