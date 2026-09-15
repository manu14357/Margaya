import { and, eq, inArray, sql } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  cycleTaskTable,
  moduleTaskTable,
  taskTable,
} from "../database/schema";
import { publishEvent } from "../events";
import type { Transaction } from "../task/assignee-writes";
import {
  insertInitialAssignees,
  setTaskAssignees,
} from "../task/assignee-writes";
import { claimTaskNumber } from "../task/controllers/claim-task-numbers";
import {
  type AppliedExtras,
  applyImportExtras,
  checkImportEstimate,
  type ImportExtrasPlan,
  publishImportExtras,
} from "../task/import-extras";
import {
  completedAtAssignment,
  completedAtForInsert,
  type TaskGroup,
} from "../task/scope";
import { IMPORTED_ACTIVITY, JIRA_SOURCE } from "./context";
import type { PlannedComment, PlannedTask } from "./plan";

// Writes one imported issue: a new task, or an update of the task an earlier
// import created. Each runs in its own transaction, so a failing issue
// leaves nothing half-written and the others still import.

export type ImportTarget = {
  projectId: string;
  workspaceId: string;
  userId: string;
};

export type ResolvedStatus = {
  status: string;
  columnId: string | null;
  group: TaskGroup;
};

async function insertComments(
  tx: Transaction,
  taskId: string,
  comments: readonly PlannedComment[],
  userId: string,
): Promise<number> {
  if (comments.length === 0) return 0;
  // Re-imports skip comments an earlier run brought in.
  const existing = await tx
    .select({ hash: sql<string>`${activityTable.eventData}->>'jiraComment'` })
    .from(activityTable)
    .where(
      and(
        eq(activityTable.taskId, taskId),
        eq(activityTable.type, "comment"),
        eq(activityTable.externalSource, JIRA_SOURCE),
      ),
    );
  const seen = new Set(existing.map((row) => row.hash));
  const fresh = comments.filter((comment) => !seen.has(comment.hash));
  if (fresh.length === 0) return 0;
  // Written directly, like the issue trackers' imports: an imported
  // conversation notifies nobody and subscribes nobody.
  await tx.insert(activityTable).values(
    fresh.map((comment) => ({
      taskId,
      type: "comment",
      userId,
      content: comment.content,
      externalUserName: comment.author,
      externalSource: JIRA_SOURCE,
      eventData: { jiraComment: comment.hash },
      ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
    })),
  );
  return fresh.length;
}

export async function createImportedTask({
  target,
  key,
  planned,
  status,
  extras,
}: {
  target: ImportTarget;
  key: string;
  planned: PlannedTask;
  status: ResolvedStatus;
  extras: ImportExtrasPlan;
}) {
  const assigneeIds = planned.assigneeId ? [planned.assigneeId] : [];
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const number = await claimTaskNumber(target.projectId, tx);
    const estimatePointId = await checkImportEstimate(
      tx,
      extras,
      target.projectId,
    );
    const [task] = await tx
      .insert(taskTable)
      .values({
        projectId: target.projectId,
        userId: assigneeIds[0] ?? null,
        title: planned.title,
        description: planned.description,
        status: status.status,
        columnId: status.columnId,
        completedAt: completedAtForInsert(
          status.group,
          planned.resolvedAt ?? now,
        ),
        // The reporter, when they're a member; else whoever imports.
        createdBy: planned.reporterId ?? target.userId,
        dueDate: planned.dueDate,
        priority: planned.priority,
        number,
        estimatePointId,
        ...(planned.createdAt ? { createdAt: planned.createdAt } : {}),
        ...(planned.updatedAt ? { updatedAt: planned.updatedAt } : {}),
      })
      .returning();
    if (!task) throw new Error("Failed to create the task");
    await insertInitialAssignees(tx, task.id, assigneeIds);
    const applied = await applyImportExtras(
      tx,
      extras,
      task,
      target.workspaceId,
      target.userId,
    );
    await tx.insert(activityTable).values({
      taskId: task.id,
      type: IMPORTED_ACTIVITY,
      userId: target.userId,
      content: key ? `Imported from Jira ${key}` : "Imported from Jira",
      externalSource: JIRA_SOURCE,
      externalUrl: key || null,
      eventData: { source: JIRA_SOURCE, key: key || null },
    });
    const comments = await insertComments(
      tx,
      task.id,
      planned.comments,
      target.userId,
    );
    return { task, applied, comments };
  });

  // The same events as the task import: realtime, webhooks, activity.
  await publishEvent("task.created", {
    ...result.task,
    taskId: result.task.id,
    userId: result.task.userId ?? "",
    assigneeIds,
    currentUserId: target.userId,
    type: "create",
    content: "imported the task",
  });
  await publishImportExtras(result.applied, result.task, target.userId);
  return { taskId: result.task.id, comments: result.comments };
}

/** Drops cycle and module joins the task already has. */
async function newMemberships(
  tx: Transaction,
  taskId: string,
  extras: ImportExtrasPlan,
) {
  if (extras.cycleId) {
    const [inCycle] = await tx
      .select({ cycleId: cycleTaskTable.cycleId })
      .from(cycleTaskTable)
      .where(eq(cycleTaskTable.taskId, taskId));
    // A task already in a cycle stays there: moving it is a planning call.
    if (inCycle) extras.cycleId = null;
  }
  if (extras.moduleIds.length > 0) {
    const joined = await tx
      .select({ moduleId: moduleTaskTable.moduleId })
      .from(moduleTaskTable)
      .where(
        and(
          eq(moduleTaskTable.taskId, taskId),
          inArray(moduleTaskTable.moduleId, extras.moduleIds),
        ),
      );
    const already = new Set(joined.map((row) => row.moduleId));
    extras.moduleIds = extras.moduleIds.filter((id) => !already.has(id));
  }
}

export async function updateImportedTask({
  target,
  taskId,
  planned,
  status,
  extras,
}: {
  target: ImportTarget;
  taskId: string;
  planned: PlannedTask;
  status: ResolvedStatus;
  extras: ImportExtrasPlan;
}): Promise<{ comments: number } | null> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: taskTable.id,
        status: taskTable.status,
        estimatePointId: taskTable.estimatePointId,
      })
      .from(taskTable)
      .where(
        and(
          eq(taskTable.id, taskId),
          eq(taskTable.projectId, target.projectId),
        ),
      )
      .for("update");
    if (!current) return null;

    const estimatePointId = await checkImportEstimate(
      tx,
      extras,
      target.projectId,
    );
    const statusChanged = current.status !== status.status;
    const [task] = await tx
      .update(taskTable)
      .set({
        title: planned.title,
        description: planned.description,
        priority: planned.priority,
        dueDate: planned.dueDate,
        ...(estimatePointId ? { estimatePointId } : {}),
        ...(statusChanged
          ? {
              status: status.status,
              columnId: status.columnId,
              completedAt: completedAtAssignment(
                status.group,
                planned.resolvedAt ?? new Date(),
              ),
            }
          : {}),
      })
      .where(eq(taskTable.id, taskId))
      .returning();
    if (!task) return null;

    if (planned.assigneeId) {
      await setTaskAssignees(tx, taskId, [planned.assigneeId]);
    }
    await newMemberships(tx, taskId, extras);
    const applied: AppliedExtras = await applyImportExtras(
      tx,
      extras,
      task,
      target.workspaceId,
      target.userId,
    );
    const comments = await insertComments(
      tx,
      taskId,
      planned.comments,
      target.userId,
    );
    return { task, applied, comments };
  });
  if (!result) return null;

  await publishEvent("task.updated", {
    taskId: result.task.id,
    projectId: result.task.projectId,
    title: result.task.title,
    status: result.task.status,
    userId: target.userId,
  });
  await publishImportExtras(result.applied, result.task, target.userId);
  return { comments: result.comments };
}
