import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  taskRecurrenceTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { shiftDate, todayUtc } from "../utils/calendar-date";
import { resolveTimezone, todayInTimezone } from "../utils/zoned-date";
import { spawnNextInstance } from "./spawn";

// Scheduled repeats: every 15 minutes, under a job lease, bounded per tick.
// A rule is due once its next run date has begun in its workspace's time
// zone; spawnNextInstance re-checks that under the rule's row lock, so a
// tick that overlaps another instance's creates nothing twice.

export const TASK_RECURRENCE_LEASE = "task-recurrence";
const LEASE_MS = 10 * 60 * 1000;

export type RecurrenceJobLimits = {
  /** Rules handled per tick, earliest run date first. */
  rules: number;
  /** No new rule starts after this many milliseconds. */
  budgetMs: number;
};

export const DEFAULT_RECURRENCE_LIMITS: RecurrenceJobLimits = {
  rules: 500,
  budgetMs: 4 * 60 * 1000,
};

export type RecurrenceJobOutcome = { degraded: boolean; created: number };

/**
 * Rules that may be due: scheduled, with a run date no later than UTC
 * tomorrow (no zone is further ahead), on a live task of a live project.
 * The exact local check happens per rule.
 */
async function loadDue(now: Date, limit: number) {
  const rows = await db
    .select({
      ruleId: taskRecurrenceTable.id,
      taskId: taskRecurrenceTable.taskId,
      nextRunDate: taskRecurrenceTable.nextRunDate,
      timezone: workspaceTable.timezone,
    })
    .from(taskRecurrenceTable)
    .innerJoin(taskTable, eq(taskTable.id, taskRecurrenceTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(taskRecurrenceTable.trigger, "schedule"),
        isNotNull(taskRecurrenceTable.nextRunDate),
        lte(taskRecurrenceTable.nextRunDate, shiftDate(todayUtc(now), 1)),
        isNull(taskTable.deletedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(asc(taskRecurrenceTable.nextRunDate), asc(taskRecurrenceTable.id))
    .limit(limit);
  return rows.filter(
    (row) =>
      row.nextRunDate !== null &&
      row.nextRunDate <= todayInTimezone(resolveTimezone(row.timezone), now),
  );
}

async function runOnce(
  now: Date,
  limits: RecurrenceJobLimits,
): Promise<RecurrenceJobOutcome> {
  const startedAt = Date.now();
  const outcome: RecurrenceJobOutcome = { degraded: false, created: 0 };
  for (const row of await loadDue(now, limits.rules)) {
    if (Date.now() - startedAt >= limits.budgetMs) break;
    try {
      const spawned = await spawnNextInstance({
        ruleId: row.ruleId,
        sourceTaskId: row.taskId,
        reason: "schedule",
        actorId: null,
        now,
      });
      if (spawned) outcome.created += 1;
    } catch (error) {
      // Ids only: titles never reach the logs.
      console.error(`task recurrence: rule ${row.ruleId} failed`, error);
      outcome.degraded = true;
    }
  }
  if (outcome.created > 0) {
    console.log(`task recurrence: created ${outcome.created} tasks`);
  }
  return outcome;
}

/** The scheduler entry: one bounded pass, on one API instance at a time. */
export async function runTaskRecurrence(
  now: Date = new Date(),
  limits: RecurrenceJobLimits = DEFAULT_RECURRENCE_LIMITS,
): Promise<RecurrenceJobOutcome> {
  return withJobLease(
    TASK_RECURRENCE_LEASE,
    () => runOnce(now, limits),
    () => ({ degraded: false, created: 0 }),
    LEASE_MS,
  );
}
