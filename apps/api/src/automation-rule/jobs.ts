import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import db from "../database";
import {
  automationRuleTable,
  automationRunTable,
  columnTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { handleTrigger } from "./engine";

// Scheduled parts of the engine, one instance at a time:
// - "due date passed": hourly, open tasks whose due date passed in the last
//   two days, once per rule, task and due date (the run's dedupe key);
// - run log retention: runs older than AUTOMATION_RUN_RETENTION_DAYS
//   (default 30; 0 keeps them) are deleted in bounded batches.

export const AUTOMATION_DUE_LEASE = "automation-due-date";
export const AUTOMATION_RETENTION_LEASE = "automation-run-retention";
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;
const DUE_WINDOW_MS = 2 * DAY_MS;
const TASKS_PER_RULE = 500;
const DEFAULT_RETENTION_DAYS = 30;

export function automationRunRetentionDays(): number {
  const raw = process.env.AUTOMATION_RUN_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
}

export function dueDedupeKey(ruleId: string, taskId: string, due: Date) {
  return `due:${ruleId}:${taskId}:${due.toISOString()}`;
}

async function dueDatePassedOnce(now: Date) {
  const rules = await db
    .select({
      id: automationRuleTable.id,
      projectId: automationRuleTable.projectId,
    })
    .from(automationRuleTable)
    .innerJoin(projectTable, eq(projectTable.id, automationRuleTable.projectId))
    .where(
      and(
        eq(automationRuleTable.enabled, true),
        eq(automationRuleTable.triggerType, "due_date_passed"),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    );
  let fired = 0;
  for (const rule of rules) {
    const tasks = await db
      .select({ id: taskTable.id, dueDate: taskTable.dueDate })
      .from(taskTable)
      .leftJoin(columnTable, eq(columnTable.id, taskTable.columnId))
      .where(
        and(
          eq(taskTable.projectId, rule.projectId),
          isNull(taskTable.archivedAt),
          isNull(taskTable.deletedAt),
          gt(taskTable.dueDate, new Date(now.getTime() - DUE_WINDOW_MS)),
          lte(taskTable.dueDate, now),
          // Open work only: done, cancelled and triage tasks are not overdue.
          sql`coalesce(${columnTable.group}, '') not in ('completed', 'cancelled', 'triage')`,
          sql`coalesce(${columnTable.isFinal}, false) = false`,
        ),
      )
      .limit(TASKS_PER_RULE);
    if (tasks.length === 0) continue;
    const keys = tasks.flatMap((task) =>
      task.dueDate ? [dueDedupeKey(rule.id, task.id, task.dueDate)] : [],
    );
    const done = new Set(
      (
        await db
          .select({ key: automationRunTable.dedupeKey })
          .from(automationRunTable)
          .where(inArray(automationRunTable.dedupeKey, keys))
      ).map((row) => row.key),
    );
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const key = dueDedupeKey(rule.id, task.id, task.dueDate);
      if (done.has(key)) continue;
      await handleTrigger(
        { type: "due_date_passed", projectId: rule.projectId, taskId: task.id },
        null,
        key,
      );
      fired += 1;
    }
  }
  return { degraded: false, fired };
}

/** Scheduler entry for the "due date passed" trigger. */
export async function runAutomationDueDates(now: Date = new Date()) {
  return withJobLease(
    AUTOMATION_DUE_LEASE,
    () => dueDatePassedOnce(now),
    () => ({ degraded: false, fired: 0 }),
    LEASE_MS,
  );
}

async function purgeOnce(now: Date, batch: number) {
  const days = automationRunRetentionDays();
  if (days === 0) return { degraded: false, deleted: 0 };
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  let deleted = 0;
  for (let round = 0; round < 50; round += 1) {
    const result = await db.execute(sql`
      delete from ${automationRunTable}
      where ${automationRunTable.id} in (
        select ${automationRunTable.id} from ${automationRunTable}
        where ${automationRunTable.createdAt} < ${cutoff}
        limit ${batch}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < batch) break;
  }
  return { degraded: false, deleted };
}

/** Scheduler entry for the run log retention. */
export async function runAutomationRunRetention(
  now: Date = new Date(),
  batch = 5000,
) {
  return withJobLease(
    AUTOMATION_RETENTION_LEASE,
    () => purgeOnce(now, batch),
    () => ({ degraded: false, deleted: 0 }),
    LEASE_MS,
  );
}
