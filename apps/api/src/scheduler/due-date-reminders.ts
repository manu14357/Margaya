import { and, between, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  projectTable,
  taskAssigneeTable,
  taskReminderSentTable,
  taskTable,
  userNotificationPreferenceTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";
import { notMutedSql } from "../notification/recipients";
import { taskAssigneeJoin } from "../task/assignees";
import { inTriageColumnSql } from "../task/scope";
import { localDateString, resolveTimezone } from "../utils/zoned-date";
import { REMINDER_WINDOW_MINUTES, userReminderType } from "./reminder-timing";

type ReminderType = "configured_before" | "overdue";

const MINUTE_MS = 60 * 1000;

function buildWindows(now: Date) {
  const nowMs = now.getTime();

  return {
    upcoming: {
      start: new Date(nowMs - REMINDER_WINDOW_MINUTES * MINUTE_MS),
      end: now,
      type: "configured_before" as ReminderType,
      notificationType: "due_date_reminder" as const,
    },
    overdue: {
      end: now,
      start: new Date(nowMs - 10 * MINUTE_MS),
      type: "overdue" as ReminderType,
      notificationType: "task_overdue" as const,
    },
  };
}

/**
 * One candidate per (task, assignee): every assignee who is still a member
 * of the task's workspace, has reminders on and has not unsubscribed from
 * the task, with their own lead time, and no reminder of this type sent to
 * them for the task yet.
 */
async function getTasksNeedingReminder(
  windowStart: Date,
  windowEnd: Date,
  reminderType: ReminderType,
) {
  const results = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      userId: taskAssigneeTable.userId,
      dueDate: taskTable.dueDate,
      projectId: taskTable.projectId,
      leadTimeMinutes:
        userNotificationPreferenceTable.dueDateReminderLeadTimeMinutes,
      timeZone: userTable.timezone,
    })
    .from(taskTable)
    .innerJoin(taskAssigneeTable, taskAssigneeJoin)
    .innerJoin(userTable, eq(userTable.id, taskAssigneeTable.userId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, taskAssigneeTable.userId),
      ),
    )
    .leftJoin(columnTable, eq(taskTable.columnId, columnTable.id))
    .leftJoin(
      userNotificationPreferenceTable,
      eq(userNotificationPreferenceTable.userId, taskAssigneeTable.userId),
    )
    .leftJoin(
      taskReminderSentTable,
      and(
        eq(taskReminderSentTable.taskId, taskTable.id),
        eq(
          taskReminderSentTable.reminderType,
          sql`${userReminderType(reminderType, "")}::text || ${taskAssigneeTable.userId}`,
        ),
      ),
    )
    .where(
      and(
        isNotNull(taskTable.dueDate),
        reminderType === "configured_before"
          ? and(
              sql`${taskTable.dueDate} - (COALESCE(${userNotificationPreferenceTable.dueDateReminderLeadTimeMinutes}, 1440) * interval '1 minute') BETWEEN ${windowStart.toISOString()} AND ${windowEnd.toISOString()}`,
              // A task already past due gets the overdue reminder only, not
              // a "due in N minutes" one (the window reaches back in time).
              gt(taskTable.dueDate, windowEnd),
            )
          : between(taskTable.dueDate, windowStart, windowEnd),
        isNull(taskReminderSentTable.id),
        or(
          isNull(userNotificationPreferenceTable.id),
          eq(userNotificationPreferenceTable.dueDateReminderEnabled, true),
        ),
        // Exclude tasks in final columns (completed); include tasks with no column
        or(isNull(columnTable.isFinal), eq(columnTable.isFinal, false)),
        // Archived tasks keep their due date but should not notify anyone
        isNull(taskTable.archivedAt),
        // No reminders for trashed tasks (C7).
        isNull(taskTable.deletedAt),
        // Intake requests are not on the board yet (B7).
        sql`not ${inTriageColumnSql}`,
        // An assignee who unsubscribed from the task gets no reminders.
        notMutedSql(taskTable.id, taskAssigneeTable.userId),
      ),
    );

  return results;
}

async function processReminder(
  task: {
    id: string;
    title: string;
    userId: string;
    dueDate: Date | null;
    projectId: string;
    leadTimeMinutes: number | null;
    timeZone: string | null;
  },
  reminderType: ReminderType,
  notificationType: "due_date_reminder" | "task_overdue",
) {
  // Insert the per-user sent record first; if it already exists, skip.
  try {
    const [inserted] = await db
      .insert(taskReminderSentTable)
      .values({
        taskId: task.id,
        reminderType: userReminderType(reminderType, task.userId),
      })
      .onConflictDoNothing({
        target: [
          taskReminderSentTable.taskId,
          taskReminderSentTable.reminderType,
        ],
      })
      .returning();

    if (!inserted) return;
  } catch (error) {
    console.error("Failed to record due date reminder", {
      taskId: task.id,
      reminderType,
      error,
    });
    return;
  }

  await createNotification({
    userId: task.userId,
    type: notificationType,
    eventData: {
      taskTitle: task.title,
      reminderType,
      leadTimeMinutes: task.leadTimeMinutes ?? 1440,
      dueDate: task.dueDate?.toISOString() ?? null,
      // The due day as the recipient sees it (their time zone, else UTC).
      dueDay: task.dueDate
        ? localDateString(task.dueDate, resolveTimezone(task.timeZone))
        : null,
    },
    resourceId: task.id,
    resourceType: "task",
  });
}

export async function checkDueDateReminders(): Promise<{ degraded: boolean }> {
  const now = new Date();
  const windows = buildWindows(now);
  let degraded = false;

  for (const window of Object.values(windows)) {
    try {
      const tasks = await getTasksNeedingReminder(
        window.start,
        window.end,
        window.type,
      );

      for (const task of tasks) {
        try {
          await processReminder(task, window.type, window.notificationType);
        } catch (error) {
          degraded = true;
          console.error("Failed to process due date reminder", {
            taskId: task.id,
            reminderType: window.type,
            error,
          });
        }
      }
    } catch (error) {
      degraded = true;
      console.error("Failed to query tasks for due date reminders", {
        reminderType: window.type,
        error,
      });
    }
  }

  return { degraded };
}
