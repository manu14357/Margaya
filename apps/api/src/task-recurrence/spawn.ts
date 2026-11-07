import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  labelTable,
  projectTable,
  taskRecurrenceTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { assertTaskEstimatePoint } from "../estimate/assert-task-estimate";
import { shareProjectEstimates } from "../estimate/write";
import { eventContext, publishEvent } from "../events";
import { archivedTaskLanding } from "../task/archive";
import type { Transaction } from "../task/assignee-writes";
import { assigneesOfTask } from "../task/assignees";
import {
  insertTaskInTransaction,
  type PreparedTaskCreate,
  publishTaskCreated,
} from "../task/controllers/create-task";
import { isTaskClosed, taskColumnJoin, taskGroupOf } from "../task/scope";
import { insertTaskActivity } from "../task-activity/insert-activity";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { filterAssignableUsers } from "../utils/assert-assignable-user";
import { daySpan } from "../utils/calendar-date";
import { resolveTimezone, todayInTimezone } from "../utils/zoned-date";
import {
  nextOnCompletion,
  nextScheduledRun,
  scheduledTarget,
  shiftInstantByDays,
  withinLimits,
} from "./rule";
import { patternOf } from "./rules";

// Creating the next instance of a repeating task. Everything happens in one
// transaction under the rule's row lock, and the rule moves to the new task
// in that transaction: a second completion event, a retried job tick or a
// second API instance finds the rule gone from the source task and creates
// nothing (idempotent).

export type SpawnReason = "completion" | "schedule";

type SpawnInput = {
  ruleId: string;
  /** The task the caller saw holding the rule. */
  sourceTaskId: string;
  reason: SpawnReason;
  /** Who completed the task; null for the scheduler. */
  actorId: string | null;
  /**
   * For "completion": a closed task (cancelled group) also ends its
   * occurrence. The auto-close automation sets it; a person cancelling a
   * task by hand still stops the series.
   */
  acceptClosed?: boolean;
  now?: Date;
};

/** Labels the source carries, minus workspace labels being deleted. */
async function sourceLabels(
  tx: Transaction,
  taskId: string,
  workspaceId: string,
) {
  const [labels, deleting] = await Promise.all([
    tx
      .select({ name: labelTable.name, color: labelTable.color })
      .from(labelTable)
      .where(eq(labelTable.taskId, taskId))
      .orderBy(asc(labelTable.createdAt), asc(labelTable.id)),
    tx
      .select({ name: labelTable.name })
      .from(labelTable)
      .where(
        and(
          eq(labelTable.workspaceId, workspaceId),
          isNull(labelTable.taskId),
          isNotNull(labelTable.deletionStartedAt),
        ),
      ),
  ]);
  const gone = new Set(deleting.map((label) => label.name));
  const seen = new Set<string>();
  return labels.filter((label) => {
    if (gone.has(label.name) || seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

/** The estimate the copy may keep: a point of the active system, or none. */
async function keptEstimate(
  tx: Transaction,
  projectId: string,
  pointId: string | null,
  estimatesEnabled: boolean,
): Promise<string | null> {
  if (!pointId || !estimatesEnabled) return null;
  await shareProjectEstimates(tx, projectId);
  try {
    await assertTaskEstimatePoint(projectId, pointId, tx);
    return pointId;
  } catch {
    return null;
  }
}

/**
 * Creates the next instance when the rule still sits on `sourceTaskId` and
 * the reason still holds (the task is completed, or the scheduled date has
 * come in the workspace's time zone). Null when there is nothing to do.
 */
export async function spawnNextInstance({
  ruleId,
  sourceTaskId,
  reason,
  actorId,
  acceptClosed = false,
  now = new Date(),
}: SpawnInput) {
  const spawned = await db.transaction(async (tx) => {
    const [rule] = await tx
      .select()
      .from(taskRecurrenceTable)
      .where(eq(taskRecurrenceTable.id, ruleId))
      .for("update");
    if (!rule || rule.taskId !== sourceTaskId || rule.trigger !== reason) {
      return null;
    }

    const [source] = await tx
      .select({
        id: taskTable.id,
        projectId: taskTable.projectId,
        number: taskTable.number,
        title: taskTable.title,
        description: taskTable.description,
        priority: taskTable.priority,
        startDate: taskTable.startDate,
        dueDate: taskTable.dueDate,
        isMilestone: taskTable.isMilestone,
        estimatePointId: taskTable.estimatePointId,
        status: taskTable.status,
        columnGroup: columnTable.group,
        completedAt: taskTable.completedAt,
        deletedAt: taskTable.deletedAt,
        slug: projectTable.slug,
        estimatesEnabled: projectTable.estimatesEnabled,
        projectArchivedAt: projectTable.archivedAt,
        projectDeletedAt: projectTable.deletedAt,
        workspaceId: projectTable.workspaceId,
        timezone: workspaceTable.timezone,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .innerJoin(
        workspaceTable,
        eq(workspaceTable.id, projectTable.workspaceId),
      )
      .leftJoin(columnTable, taskColumnJoin)
      .where(eq(taskTable.id, sourceTaskId))
      .limit(1);
    // A trashed task or project pauses the series until it is restored.
    if (
      !source ||
      source.deletedAt ||
      source.projectDeletedAt ||
      source.projectArchivedAt
    ) {
      return null;
    }

    const tz = resolveTimezone(source.timezone);
    const today = todayInTimezone(tz, now);
    const pattern = patternOf(rule);

    let target: string | null;
    if (reason === "completion") {
      const closed =
        acceptClosed &&
        isTaskClosed(
          taskGroupOf(
            source.status,
            source.columnGroup ? { group: source.columnGroup } : null,
          ),
        );
      if (!source.completedAt && !closed) return null;
      target = nextOnCompletion(pattern, today);
    } else {
      if (!rule.nextRunDate || rule.nextRunDate > today) return null;
      target = scheduledTarget(pattern, rule.nextRunDate, today);
      if (!withinLimits(pattern, target)) target = null;
    }
    if (!target) {
      // The series has ended; the schedule stops looking at it.
      if (rule.nextRunDate) {
        await tx
          .update(taskRecurrenceTable)
          .set({ nextRunDate: null })
          .where(eq(taskRecurrenceTable.id, rule.id));
      }
      return null;
    }

    const shift = daySpan(rule.anchorDate, target);
    const landing = await archivedTaskLanding(tx, source.projectId, "entry");
    const assigneeIds = await assigneesOfTask(source.id, tx);
    const assignable = await filterAssignableUsers(
      assigneeIds,
      source.workspaceId,
      tx,
    );
    const prepared: PreparedTaskCreate = {
      projectId: source.projectId,
      currentUserId: actorId ?? "",
      title: source.title,
      description: source.description ?? "",
      status: landing.status,
      column: landing.columnId
        ? { id: landing.columnId, group: landing.group }
        : undefined,
      archived: false,
      priority: source.priority,
      startDate: source.startDate
        ? shiftInstantByDays(source.startDate, shift, tz)
        : null,
      dueDate: source.dueDate
        ? shiftInstantByDays(source.dueDate, shift, tz)
        : null,
      assigneeIds: assigneeIds.filter((id) => assignable.has(id)),
      assigneeName: undefined,
      customFields: [],
      isMilestone: source.isMilestone,
      estimatePointId: await keptEstimate(
        tx,
        source.projectId,
        source.estimatePointId,
        source.estimatesEnabled,
      ),
    };
    const task = await insertTaskInTransaction(tx, prepared);

    const labels = await sourceLabels(tx, source.id, source.workspaceId);
    if (labels.length > 0) {
      await tx
        .insert(labelTable)
        .values(
          labels.map((label) => ({
            name: label.name,
            color: label.color,
            taskId: task.id,
            workspaceId: source.workspaceId,
          })),
        )
        .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] });
    }

    const moved = {
      ...pattern,
      anchorDate: target,
      occurrenceCount: rule.occurrenceCount + 1,
    };
    await tx
      .update(taskRecurrenceTable)
      .set({
        taskId: task.id,
        anchorDate: target,
        occurrenceCount: moved.occurrenceCount,
        nextRunDate:
          rule.trigger === "schedule" ? nextScheduledRun(moved) : null,
      })
      .where(eq(taskRecurrenceTable.id, rule.id));

    const sourceKey = formatTaskKey(source.slug, source.number);
    const taskKey = formatTaskKey(source.slug, task.number);
    await insertTaskActivity(
      {
        taskId: task.id,
        type: "recurred_from",
        userId: actorId,
        eventData: {
          sourceTaskId: source.id,
          sourceTaskKey: sourceKey,
          sourceTaskTitle: source.title,
          projectId: source.projectId,
          date: target,
          reason,
        },
      },
      tx,
    );
    await insertTaskActivity(
      {
        taskId: source.id,
        type: "recurred_to",
        userId: actorId,
        eventData: {
          nextTaskId: task.id,
          nextTaskKey: taskKey,
          nextTaskTitle: task.title,
          projectId: source.projectId,
          date: target,
          reason,
        },
      },
      tx,
    );

    return { task, prepared, source, key: taskKey, date: target };
  });

  if (!spawned) return null;
  const { task, prepared, source } = spawned;
  // Outside the request's event context: the person who completed the task
  // did not create the next one, so their own board gets the hint too.
  await eventContext.exit(async () => {
    await publishTaskCreated(task, prepared, { source: "recurrence" });
    // The source's card loses its repeat icon.
    await publishEvent("task.recurrence_changed", {
      taskId: source.id,
      projectId: source.projectId,
      userId: actorId,
      action: "moved",
      nextTaskId: task.id,
    });
  });
  return {
    task: { ...task, assigneeIds: prepared.assigneeIds },
    key: spawned.key,
    date: spawned.date,
  };
}
