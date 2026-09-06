import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type db from "../database";
import { labelTable, taskTable } from "../database/schema";
import type { EstimateTotals } from "../estimate/types";
import { getWorkspaceTimezone } from "../utils/timezone";
import { assigneeDetailsOfTasks } from "./assignees";
import {
  buildProgressReport,
  type GroupCounts,
  type ProgressReport,
  type ScopeTask,
  type ScopeTaskLabel,
} from "./progress";
import { taskGroupSql } from "./scope";

// Select fragments shared by the planning features' progress queries. Each
// feature joins its own membership table; these only name what to read.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction; the helpers here only read. */
export type Reader = Pick<Transaction, "select">;

function groupCount(group: string) {
  return count(sql`case when ${taskGroupSql} = ${group} then 1 end`);
}

/**
 * Per-group counts for a grouped query. Needs `columnTable` LEFT JOINed with
 * `taskColumnJoin`; fold the row with `toGroupCounts`.
 */
export function groupCountColumns() {
  return {
    total: count(),
    backlog: groupCount("backlog"),
    unstarted: groupCount("unstarted"),
    started: groupCount("started"),
    completed: groupCount("completed"),
    cancelled: groupCount("cancelled"),
  };
}

export function toGroupCounts(row: Record<keyof GroupCounts, unknown>) {
  return {
    total: Number(row.total),
    backlog: Number(row.backlog),
    unstarted: Number(row.unstarted),
    started: Number(row.started),
    completed: Number(row.completed),
    cancelled: Number(row.cancelled),
  } satisfies GroupCounts;
}

/**
 * The `ScopeTask` fields. Needs `columnTable` LEFT JOINed with
 * `taskColumnJoin`. Assignees are read separately (reportFromScope).
 */
export function scopeTaskColumns() {
  return {
    id: taskTable.id,
    group: taskGroupSql,
    priority: taskTable.priority,
    completedAt: taskTable.completedAt,
    updatedAt: taskTable.updatedAt,
  };
}

/** The `ScopeTaskLabel` fields, read from the task label copies. */
export function scopeTaskLabelColumns() {
  return {
    id: labelTable.id,
    taskId: labelTable.taskId,
    name: labelTable.name,
    color: labelTable.color,
    createdAt: labelTable.createdAt,
  };
}

/** Drops label rows without a task (workspace labels never match here). */
export function toScopeTaskLabels(
  rows: Array<Omit<ScopeTaskLabel, "taskId"> & { taskId: string | null }>,
): ScopeTaskLabel[] {
  return rows.flatMap((row) =>
    row.taskId ? [{ ...row, taskId: row.taskId }] : [],
  );
}

/** Colors of the workspace labels (not task copies) with these names. */
export async function workspaceLabelColors(
  reader: Reader,
  workspaceId: string,
  names: string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const rows = await reader
    .select({ name: labelTable.name, color: labelTable.color })
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        isNull(labelTable.taskId),
        inArray(labelTable.name, names),
      ),
    );
  return new Map(rows.map((row) => [row.name, row.color]));
}

/**
 * The progress report over already loaded scope rows, with the scope's
 * assignees read in the same snapshot. `estimates` and `estimateValues`
 * come from the estimate helpers (`getScopeEstimates`).
 */
export async function reportFromScope(
  reader: Reader,
  {
    workspaceId,
    tasks,
    labels,
    startDate,
    endDate,
    today,
    maxChartDays,
    estimates,
    estimateValues,
  }: {
    workspaceId: string;
    tasks: ScopeTask[];
    labels: ScopeTaskLabel[];
    startDate: string | null;
    endDate: string | null;
    today: string;
    maxChartDays?: number;
    estimates?: EstimateTotals | null;
    estimateValues?: ReadonlyMap<string, number>;
  },
): Promise<ProgressReport> {
  const workspaceColors = await workspaceLabelColors(reader, workspaceId, [
    ...new Set(labels.map((label) => label.name)),
  ]);
  const assignees = await assigneeDetailsOfTasks(
    tasks.map((task) => task.id),
    reader,
  );
  return buildProgressReport({
    startDate,
    endDate,
    today,
    timezone: await getWorkspaceTimezone(workspaceId, reader),
    maxChartDays,
    tasks,
    assignees,
    labels,
    workspaceColors,
    estimates,
    estimateValues,
  });
}
