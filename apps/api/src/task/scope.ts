import {
  and,
  eq,
  getTableName,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type ColumnGroup,
  isClosedGroup,
  isCompletedGroup,
  isOpenGroup,
} from "../column/groups";
import { columnTable, taskTable } from "../database/schema";

// The single source of task-group semantics. Later slices (cycles, modules,
// views, analytics) read groups, completion and visibility through these
// helpers and never compare raw status slugs.

export const PLANNED_STATUS = "planned";
/**
 * Legacy input alias only (D7): writing this status archives the task and
 * keeps its column. Stored rows never carry it after the boot migration;
 * being archived is `task.archivedAt`.
 */
export const ARCHIVED_STATUS = "archived";

/** A task's group: its column's group; planned tasks are backlog. */
export type TaskGroup = ColumnGroup;

type ColumnLike = { group: ColumnGroup } | null | undefined;

/**
 * Resolves a task's group from its status and the column whose slug matches
 * it. `planned` is Margaya's backlog; a status with no matching column
 * (legacy data) is treated as not started. Archiving never changes it.
 */
export function taskGroupOf(status: string, column: ColumnLike): TaskGroup {
  if (status === PLANNED_STATUS) return "backlog";
  return column?.group ?? "unstarted";
}

export function isTaskClosed(group: TaskGroup): boolean {
  return isClosedGroup(group);
}

export function isTaskCompleted(group: TaskGroup): boolean {
  return isCompletedGroup(group);
}

export function isTaskOpen(group: TaskGroup): boolean {
  return isOpenGroup(group);
}

/** True while the task is archived. */
export function isTaskArchived(task: { archivedAt: Date | null }): boolean {
  return task.archivedAt !== null;
}

export type StatusInput =
  | { archive: true }
  | { archive: false; status: string };

/**
 * The legacy status input: a written status of `archived` means "archive
 * and keep the column"; anything else is a real status. Every write path
 * handles the alias through this.
 */
export function parseStatusInput(status: string): StatusInput {
  return status === ARCHIVED_STATUS
    ? { archive: true }
    : { archive: false, status };
}

/**
 * The next `completedAt` for a task moving to `nextGroup`: entering or staying
 * in completed keeps an existing timestamp (or stamps `now`); anything else
 * clears it. Archiving and restoring never call this.
 */
export function resolveCompletedAt(
  previousCompletedAt: Date | null,
  nextGroup: TaskGroup,
  now: Date,
): Date | null {
  if (nextGroup === "completed") return previousCompletedAt ?? now;
  return null;
}

/**
 * The `completedAt` assignment for an UPDATE that moves tasks to `nextGroup`,
 * applied in the same statement as the status change.
 */
export function completedAtAssignment(
  nextGroup: TaskGroup,
  now: Date,
): SQL | null {
  if (nextGroup === "completed") {
    // Encode through the column so the timestamp is stored in UTC like every
    // other drizzle write; a raw Date parameter would use the local zone.
    return sql`coalesce(${taskTable.completedAt}, ${sql.param(now, taskTable.completedAt)})`;
  }
  return null;
}

/** The `completedAt` value for a newly inserted task. */
export function completedAtForInsert(group: TaskGroup, now: Date): Date | null {
  return resolveCompletedAt(null, group, now);
}

/**
 * Progress over a set of tasks: completed ÷ (visible − cancelled), rounded.
 * No visible tasks gives 0; everything cancelled gives 100.
 */
export function progressPercent({
  completed,
  cancelled,
  visible,
}: {
  completed: number;
  cancelled: number;
  visible: number;
}): number {
  if (visible <= 0) return 0;
  const denominator = visible - cancelled;
  if (denominator <= 0) return 100;
  return Math.round((completed / denominator) * 100);
}

type PositionedColumn = { position: number; group: ColumnGroup };

function byPosition<T extends PositionedColumn>(columns: readonly T[]): T[] {
  return [...columns].sort((a, b) => a.position - b.position);
}

/**
 * Where new or reopened work lands: the first not-started column, otherwise
 * the first open column, otherwise none.
 */
export function entryColumn<T extends PositionedColumn>(
  columns: readonly T[],
): T | null {
  const ordered = byPosition(columns);
  return (
    ordered.find((column) => column.group === "unstarted") ??
    ordered.find((column) => isOpenGroup(column.group)) ??
    null
  );
}

/** The first completed-group column by position, or none. */
export function completedColumn<T extends PositionedColumn>(
  columns: readonly T[],
): T | null {
  return (
    byPosition(columns).find((column) => column.group === "completed") ?? null
  );
}

// --- SQL helpers -----------------------------------------------------------

/**
 * Join condition from a task to the column its status points at. Status is
 * the source of truth (the startup migration keeps `columnId` in sync with
 * it), and slugs are unique per project.
 */
export const taskColumnJoin = and(
  eq(columnTable.projectId, taskTable.projectId),
  eq(columnTable.slug, taskTable.status),
) as SQL;

/**
 * A task's group as SQL. Requires `columnTable` LEFT JOINed with
 * `taskColumnJoin`. Planned gives backlog; archived tasks keep their
 * column's group.
 */
export const taskGroupSql = sql<TaskGroup>`case
  when ${taskTable.status} = ${PLANNED_STATUS} then 'backlog'
  else coalesce(${columnTable.group}, 'unstarted')
end`;

/** The task columns the scope helpers read, so aliases work too. */
type TaskScopeColumns = {
  projectId: AnyPgColumn;
  status: AnyPgColumn;
  archivedAt: AnyPgColumn;
  deletedAt: AnyPgColumn;
};

const TRIAGE_COLUMN_ALIAS = "triage_column";

/**
 * `"table"."column"`, qualified explicitly. Drizzle leaves columns bare in
 * some positions (the select list of a single-table query, update and delete
 * statements), where a correlated subquery would then read its own column.
 * The table is the alias when the column comes from one.
 */
function qualified(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

function triageColumnField(column: AnyPgColumn): SQL {
  return sql`${sql.identifier(TRIAGE_COLUMN_ALIAS)}.${sql.identifier(column.name)}`;
}

/**
 * True when this (possibly aliased) task sits in a triage column. Usable in
 * select lists and where clauses of the query builder and in update and
 * delete; not in relational (db.query) where clauses, which rename the root
 * table.
 */
export function inTriageColumnSqlOf(task: TaskScopeColumns): SQL<boolean> {
  return sql<boolean>`exists (
  select 1 from ${columnTable} as ${sql.identifier(TRIAGE_COLUMN_ALIAS)}
  where ${triageColumnField(columnTable.projectId)} = ${qualified(task.projectId)}
    and ${triageColumnField(columnTable.slug)} = ${qualified(task.status)}
    and ${triageColumnField(columnTable.group)} = 'triage'
)`;
}

/** True when the task sits in a triage column (self-contained subquery). */
export const inTriageColumnSql = inTriageColumnSqlOf(taskTable);

/**
 * A (possibly aliased) task that is not in the trash (C7). Trashed tasks
 * behave as if they no longer exist everywhere but the trash views, so every
 * read of live tasks keeps this; the scopes below already include it.
 */
export function liveTaskConditionOf(task: { deletedAt: AnyPgColumn }): SQL {
  return isNull(task.deletedAt);
}

/** The task is not in the trash. */
export const liveTaskCondition = liveTaskConditionOf(taskTable);

/** The archived-task condition (D7): `archivedAt` is set. */
export const archivedTaskCondition = isNotNull(taskTable.archivedAt);

export type ArchivedScope = "exclude" | "include" | "only";

/**
 * Which archived tasks a read keeps. Every scope leaves out trashed tasks;
 * "include" keeps archived and unarchived ones.
 */
export function archivedCondition(scope: ArchivedScope): SQL {
  if (scope === "exclude") {
    return and(liveTaskCondition, isNull(taskTable.archivedAt)) as SQL;
  }
  if (scope === "only") {
    return and(liveTaskCondition, archivedTaskCondition) as SQL;
  }
  return liveTaskCondition;
}

/**
 * The visible scope of a (possibly aliased) task: not trashed, not archived
 * and not in a triage column. Drafts never need a condition: they live in
 * `task_draft` and only become tasks when published.
 */
export function visibleTaskConditionOf(task: TaskScopeColumns): SQL {
  return and(
    isNull(task.deletedAt),
    isNull(task.archivedAt),
    sql`not ${inTriageColumnSqlOf(task)}`,
  ) as SQL;
}

/** The visible task scope: not trashed, not archived, not in triage. */
export const visibleTaskCondition = visibleTaskConditionOf(taskTable);
