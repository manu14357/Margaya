import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectTable,
  taskRecurrenceTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { publishEvent } from "../events";
import type { Transaction } from "../task/assignee-writes";
import { inTriageColumnSql } from "../task/scope";
import { insertTaskActivity } from "../task-activity/insert-activity";
import {
  localDateString,
  resolveTimezone,
  todayInTimezone,
} from "../utils/zoned-date";
import {
  nextOnCompletion,
  nextScheduledRun,
  type RecurrenceFrequency,
  type RecurrencePattern,
  type RecurrenceTrigger,
} from "./rule";
import type { SetTaskRecurrenceInput } from "./schema";

type Reader = Pick<Transaction, "select">;
export type TaskRecurrenceRow = typeof taskRecurrenceTable.$inferSelect;

/** The task fields a repeat rule needs, with its workspace's time zone. */
export async function loadRecurrenceTask(taskId: string, reader: Reader = db) {
  const [task] = await reader
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      timezone: workspaceTable.timezone,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      deletedAt: taskTable.deletedAt,
      inTriage: inTriageColumnSql,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) return null;
  return { ...task, timezone: resolveTimezone(task.timezone) };
}

/** The pattern fields of a stored rule. */
export function patternOf(rule: TaskRecurrenceRow): RecurrencePattern {
  return {
    frequency: rule.frequency as RecurrenceFrequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    anchorDate: rule.anchorDate,
    endDate: rule.endDate,
    maxOccurrences: rule.maxOccurrences,
    occurrenceCount: rule.occurrenceCount,
  };
}

/** The API shape of a rule; `today` is the workspace's calendar date. */
export function presentRecurrence(rule: TaskRecurrenceRow, today: string) {
  const trigger = rule.trigger as RecurrenceTrigger;
  return {
    taskId: rule.taskId,
    frequency: rule.frequency as RecurrenceFrequency,
    interval: rule.interval,
    weekdays: rule.weekdays ?? [],
    monthDay: rule.monthDay,
    trigger,
    anchorDate: rule.anchorDate,
    endDate: rule.endDate,
    maxOccurrences: rule.maxOccurrences,
    occurrenceCount: rule.occurrenceCount,
    nextDate:
      trigger === "schedule"
        ? rule.nextRunDate
        : nextOnCompletion(patternOf(rule), today),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

/** What an activity row keeps of a rule, so history stays readable. */
function ruleSummary(rule: TaskRecurrenceRow) {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays ?? [],
    monthDay: rule.monthDay,
    trigger: rule.trigger,
    endDate: rule.endDate,
    maxOccurrences: rule.maxOccurrences,
  };
}

async function requireLiveTask(taskId: string) {
  const task = await loadRecurrenceTask(taskId);
  if (!task || task.deletedAt) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  return task;
}

export async function getTaskRecurrence(taskId: string, now = new Date()) {
  const task = await requireLiveTask(taskId);
  const [rule] = await db
    .select()
    .from(taskRecurrenceTable)
    .where(eq(taskRecurrenceTable.taskId, taskId))
    .limit(1);
  return {
    recurrence: rule
      ? presentRecurrence(rule, todayInTimezone(task.timezone, now))
      : null,
  };
}

/**
 * Sets or replaces a task's repeat rule. The anchor is the task's own date
 * (due date, else start date, else today) in the workspace's time zone; a
 * replaced rule keeps its instance count.
 */
export async function setTaskRecurrence({
  taskId,
  userId,
  input,
  now = new Date(),
}: {
  taskId: string;
  userId: string;
  input: SetTaskRecurrenceInput;
  now?: Date;
}) {
  const task = await requireLiveTask(taskId);
  if (task.inTriage) {
    throw new HTTPException(409, {
      message: "A task waiting in intake can't repeat",
    });
  }
  const tz = task.timezone;
  const today = todayInTimezone(tz, now);
  const ownDate = task.dueDate ?? task.startDate;
  const anchorDate = ownDate ? localDateString(ownDate, tz) : today;
  const trigger = input.trigger ?? "completion";

  const { rule, updated } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(taskRecurrenceTable)
      .where(eq(taskRecurrenceTable.taskId, taskId))
      .for("update");
    const values = {
      frequency: input.frequency,
      interval: input.interval ?? 1,
      weekdays:
        input.frequency === "weekly" && input.weekdays
          ? [...new Set(input.weekdays)].sort((a, b) => a - b)
          : null,
      monthDay:
        input.frequency === "monthly" || input.frequency === "yearly"
          ? (input.monthDay ?? null)
          : null,
      trigger,
      anchorDate,
      endDate: input.endDate ?? null,
      maxOccurrences: input.maxOccurrences ?? null,
      occurrenceCount: existing?.occurrenceCount ?? 1,
    };
    const nextRunDate =
      trigger === "schedule" ? nextScheduledRun(values) : null;

    const [rule] = existing
      ? await tx
          .update(taskRecurrenceTable)
          .set({ ...values, nextRunDate })
          .where(eq(taskRecurrenceTable.id, existing.id))
          .returning()
      : await tx
          .insert(taskRecurrenceTable)
          .values({ ...values, nextRunDate, taskId, createdBy: userId })
          .returning();
    if (!rule) {
      throw new HTTPException(500, { message: "Failed to save the repeat" });
    }
    await insertTaskActivity(
      {
        taskId,
        type: "recurrence_set",
        userId,
        eventData: { ...ruleSummary(rule), updated: Boolean(existing) },
      },
      tx,
    );
    return { rule, updated: Boolean(existing) };
  });

  await publishEvent("task.recurrence_changed", {
    taskId,
    projectId: task.projectId,
    userId,
    action: updated ? "updated" : "set",
  });
  return { recurrence: presentRecurrence(rule, today) };
}

/** Stops the repeat: no further instances. Removing nothing is a no-op. */
export async function removeTaskRecurrence({
  taskId,
  userId,
}: {
  taskId: string;
  userId: string;
}) {
  const task = await requireLiveTask(taskId);
  const removed = await db.transaction(async (tx) => {
    const [rule] = await tx
      .delete(taskRecurrenceTable)
      .where(eq(taskRecurrenceTable.taskId, taskId))
      .returning();
    if (!rule) return false;
    await insertTaskActivity(
      {
        taskId,
        type: "recurrence_removed",
        userId,
        eventData: ruleSummary(rule),
      },
      tx,
    );
    return true;
  });
  if (removed) {
    await publishEvent("task.recurrence_changed", {
      taskId,
      projectId: task.projectId,
      userId,
      action: "removed",
    });
  }
  return { recurrence: null };
}
