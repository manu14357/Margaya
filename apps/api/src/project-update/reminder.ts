import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  projectUpdateReminderTable,
  projectUpdateTable,
  workspaceTable,
} from "../database/schema";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";
import {
  localDateTimeParts,
  resolveTimezone,
  todayInTimezone,
} from "../utils/zoned-date";
import { notifyLeadToPostUpdate } from "./notify";

// The optional weekly reminder to a project lead to post a status update.
// Off unless someone turns it on for the project. The hourly job sends it on
// the chosen weekday from 9:00 in the workspace's time zone, at most once
// every 6 days, and skips leads who already posted in that time.

export const PROJECT_UPDATE_REMINDER_LEASE = "project-update-reminders";
export const REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_WEEKDAY = 5;
const QUIET_MS = 6 * 86_400_000;
const BATCH = 500;

export type ReminderOutcome = { sent: number; degraded: boolean };

/** Whether a reminder is due now, from pure inputs. */
export function reminderDue(input: {
  weekday: number;
  timeZone: string;
  now: Date;
  lastRemindedAt: Date | null;
  lastUpdateAt: Date | null;
}): boolean {
  const zone = resolveTimezone(input.timeZone);
  const today = todayInTimezone(zone, input.now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday !== input.weekday) return false;
  if (localDateTimeParts(input.now, zone).hour < REMINDER_HOUR) return false;
  const quietSince = input.now.getTime() - QUIET_MS;
  if (input.lastRemindedAt && input.lastRemindedAt.getTime() > quietSince) {
    return false;
  }
  if (input.lastUpdateAt && input.lastUpdateAt.getTime() > quietSince) {
    return false;
  }
  return true;
}

async function runReminders(now: Date): Promise<ReminderOutcome> {
  const candidates = await db
    .select({
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: projectTable.workspaceId,
      leadUserId: projectTable.leadUserId,
      timeZone: workspaceTable.timezone,
      weekday: projectUpdateReminderTable.weekday,
      lastRemindedAt: projectUpdateReminderTable.lastRemindedAt,
      lastUpdateAt: sql<Date | null>`(
        select max(${projectUpdateTable.createdAt}) from ${projectUpdateTable}
        where ${projectUpdateTable.projectId} = ${projectTable.id}
      )`.mapWith((value) => (value ? new Date(value) : null)),
    })
    .from(projectUpdateReminderTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectUpdateReminderTable.projectId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(projectUpdateReminderTable.enabled, true),
        eq(projectTable.updatesEnabled, true),
        isNotNull(projectTable.leadUserId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .orderBy(desc(projectUpdateReminderTable.projectId))
    .limit(BATCH);

  let sent = 0;
  let degraded = false;
  for (const candidate of candidates) {
    if (!candidate.leadUserId) continue;
    if (
      !reminderDue({
        weekday: candidate.weekday,
        timeZone: candidate.timeZone ?? "UTC",
        now,
        lastRemindedAt: candidate.lastRemindedAt,
        lastUpdateAt: candidate.lastUpdateAt,
      })
    ) {
      continue;
    }
    try {
      // Stamp first, so a second instance or a retry never sends twice.
      const claimed = await db
        .update(projectUpdateReminderTable)
        .set({ lastRemindedAt: now })
        .where(
          and(
            eq(projectUpdateReminderTable.projectId, candidate.projectId),
            sql`${projectUpdateReminderTable.lastRemindedAt} is not distinct from ${candidate.lastRemindedAt?.toISOString() ?? null}::timestamptz`,
          ),
        )
        .returning({ projectId: projectUpdateReminderTable.projectId });
      if (claimed.length === 0) continue;
      const notification = await notifyLeadToPostUpdate({
        leadUserId: candidate.leadUserId,
        projectId: candidate.projectId,
        workspaceId: candidate.workspaceId,
        projectName: candidate.projectName,
      });
      if (notification) sent += 1;
    } catch (error) {
      degraded = true;
      console.error("Failed to send a project update reminder", {
        projectId: candidate.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent, degraded };
}

/** The scheduler job (hourly). */
export function sendProjectUpdateReminders(
  now: Date = new Date(),
): Promise<ReminderOutcome> {
  return withJobLease(
    PROJECT_UPDATE_REMINDER_LEASE,
    () => runReminders(now),
    () => ({ sent: 0, degraded: false }),
    { holdMs: HOURLY_JOB_HOLD_MS },
  );
}

export async function getReminder(projectId: string) {
  const [[row], [project]] = await Promise.all([
    db
      .select({
        enabled: projectUpdateReminderTable.enabled,
        weekday: projectUpdateReminderTable.weekday,
      })
      .from(projectUpdateReminderTable)
      .where(eq(projectUpdateReminderTable.projectId, projectId))
      .limit(1),
    db
      .select({ leadUserId: projectTable.leadUserId })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1),
  ]);
  return {
    enabled: row?.enabled ?? false,
    weekday: row?.weekday ?? DEFAULT_REMINDER_WEEKDAY,
    leadUserId: project?.leadUserId ?? null,
  };
}

export async function setReminder(
  projectId: string,
  input: { enabled: boolean; weekday?: number },
) {
  const weekday = input.weekday ?? DEFAULT_REMINDER_WEEKDAY;
  await db
    .insert(projectUpdateReminderTable)
    .values({ projectId, enabled: input.enabled, weekday })
    .onConflictDoUpdate({
      target: projectUpdateReminderTable.projectId,
      set: {
        enabled: input.enabled,
        ...(input.weekday === undefined ? {} : { weekday }),
        updatedAt: new Date(),
      },
    });
  return getReminder(projectId);
}
