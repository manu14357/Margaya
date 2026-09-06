import { asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import { taskAssigneeTable, taskTable, userTable } from "../database/schema";

// The one way to read a task's assignees. `task_assignee` is the source of
// truth; `task.userId` (assignee_id) only mirrors the first assignee for
// integrations and old clients. Every feature that asks "who is assigned"
// uses these readers or SQL fragments and never joins on the mirror.
//
// Order everywhere: position, then when the row was added, then user id.
// Semantics: "assigned to X" means X is anywhere in the set; filters are
// any-of; per-assignee counts count a task once per assignee while totals
// count distinct tasks. Pure rules live in assignee-rules.ts, writers in
// assignee-writes.ts.

export {
  MAX_TASK_ASSIGNEES,
  TOO_MANY_ASSIGNEES,
} from "./assignee-rules";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction; the readers only select. */
export type AssigneeReader = Pick<Transaction, "select">;

/** A task assignee as payloads show it. Never carries the email. */
export type TaskAssignee = { id: string; name: string; image: string | null };

const READ_BATCH = 1000;

/** Assignee order, for any query over `task_assignee`. */
export const assigneeOrderBy = [
  asc(taskAssigneeTable.position),
  asc(taskAssigneeTable.createdAt),
  asc(taskAssigneeTable.userId),
] as const;

function batches(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += READ_BATCH) {
    out.push(unique.slice(i, i + READ_BATCH));
  }
  return out;
}

/**
 * Batch loader: every requested task id maps to its assignee ids in order
 * (an empty list when unassigned). One query per 1,000 tasks.
 */
export async function assigneesOfTasks(
  taskIds: readonly string[],
  reader: AssigneeReader = db,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  for (const batch of batches(taskIds)) {
    const rows = await reader
      .select({
        taskId: taskAssigneeTable.taskId,
        userId: taskAssigneeTable.userId,
      })
      .from(taskAssigneeTable)
      .where(inArray(taskAssigneeTable.taskId, batch))
      .orderBy(asc(taskAssigneeTable.taskId), ...assigneeOrderBy);
    for (const row of rows) result.get(row.taskId)?.push(row.userId);
  }
  return result;
}

/**
 * Like `assigneesOfTasks`, in exactly one query however many tasks (the id
 * list is one array parameter), for readers that promise a fixed number of
 * statements, such as the task query engine.
 */
export async function assigneeIdsOfTasks(
  taskIds: readonly string[],
  reader: AssigneeReader = db,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return result;
  const rows = await reader
    .select({
      taskId: taskAssigneeTable.taskId,
      userId: taskAssigneeTable.userId,
    })
    .from(taskAssigneeTable)
    .where(
      sql`${taskAssigneeTable.taskId} = any(${sql.param([...new Set(taskIds)])}::text[])`,
    )
    .orderBy(asc(taskAssigneeTable.taskId), ...assigneeOrderBy);
  for (const row of rows) result.get(row.taskId)?.push(row.userId);
  return result;
}

/** One task's assignee ids, first assignee first. */
export async function assigneesOfTask(
  taskId: string,
  reader: AssigneeReader = db,
): Promise<string[]> {
  return (await assigneesOfTasks([taskId], reader)).get(taskId) ?? [];
}

/**
 * Like `assigneesOfTasks`, with each user's name and avatar (one query per
 * 1,000 tasks, joined to the user). For boards, task detail and relations.
 */
export async function assigneeDetailsOfTasks(
  taskIds: readonly string[],
  reader: AssigneeReader = db,
): Promise<Map<string, TaskAssignee[]>> {
  const result = new Map<string, TaskAssignee[]>(taskIds.map((id) => [id, []]));
  for (const batch of batches(taskIds)) {
    const rows = await reader
      .select({
        taskId: taskAssigneeTable.taskId,
        id: userTable.id,
        name: userTable.name,
        image: userTable.image,
      })
      .from(taskAssigneeTable)
      .innerJoin(userTable, eq(userTable.id, taskAssigneeTable.userId))
      .where(inArray(taskAssigneeTable.taskId, batch))
      .orderBy(asc(taskAssigneeTable.taskId), ...assigneeOrderBy);
    for (const { taskId, ...assignee } of rows) {
      result.get(taskId)?.push(assignee);
    }
  }
  return result;
}

/** A task row plus its `assigneeIds`, for task-returning controllers. */
export async function withAssigneeIds<T extends { id: string }>(
  task: T,
  reader: AssigneeReader = db,
): Promise<T & { assigneeIds: string[] }> {
  return { ...task, assigneeIds: await assigneesOfTask(task.id, reader) };
}

// --- SQL fragments -----------------------------------------------------------
// Correlated to the outer, unaliased `task` row (like task/scope.ts). The
// subqueries use their own aliases, so an outer join on `task_assignee`
// never clashes with them.

/**
 * In a single-table select, drizzle drops the table prefix of the column
 * chunks at the top level of a selected `sql` field, which would turn the
 * correlation into a self-comparison. Nesting keeps every column qualified.
 */
function qualified<T>(fragment: SQL<T>): SQL<T> {
  return sql<T>`${fragment}`;
}

const FILTER_ALIAS = "task_assignee_filter";
const filterRow = alias(taskAssigneeTable, FILTER_ALIAS);

/** True when one of these users is an assignee of the task (any-of). */
export function hasAnyAssignee(userIds: readonly string[]): SQL<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return sql<boolean>`false`;
  return qualified(sql<boolean>`exists (
    select 1 from ${taskAssigneeTable} as ${sql.identifier(FILTER_ALIAS)}
    where ${filterRow.taskId} = ${taskTable.id}
      and ${inArray(filterRow.userId, ids)}
  )`);
}

/** True when the task has no assignees (the `none` filter token). */
export const hasNoAssigneeSql = qualified(sql<boolean>`not exists (
  select 1 from ${taskAssigneeTable} as ${sql.identifier(FILTER_ALIAS)}
  where ${filterRow.taskId} = ${taskTable.id}
)`);

const ORDERED_ALIAS = "task_assignee_ordered";
const orderedRow = alias(taskAssigneeTable, ORDERED_ALIAS);

/**
 * SQL form of `assigneesOfTask`: the task's assignee ids as a text array in
 * assignee order, empty when unassigned. For selects such as a spreadsheet
 * column.
 */
export const assigneesOfTaskSql = qualified(sql<string[]>`coalesce((
  select array_agg(${orderedRow.userId} order by ${orderedRow.position}, ${orderedRow.createdAt}, ${orderedRow.userId})
  from ${taskAssigneeTable} as ${sql.identifier(ORDERED_ALIAS)}
  where ${orderedRow.taskId} = ${taskTable.id}
), '{}')`);

/**
 * Join condition that fans a task out into one row per assignee, with
 * `task_assignee` as the joined table. LEFT JOIN it to keep unassigned
 * tasks as one row with a null user (the "Unassigned" group).
 */
export const taskAssigneeJoin = eq(taskAssigneeTable.taskId, taskTable.id);

const RANK_ALIAS = "task_assignee_rank";
const rankRow = alias(taskAssigneeTable, RANK_ALIAS);

/** 1-based rank of a joined `task_assignee` row in its task's order. */
export const assigneeRankSql = qualified(sql<number>`(
  select count(*) from ${taskAssigneeTable} as ${sql.identifier(RANK_ALIAS)}
  where ${rankRow.taskId} = ${taskAssigneeTable.taskId}
    and (${rankRow.position}, ${rankRow.createdAt}, ${rankRow.userId})
      < (${taskAssigneeTable.position}, ${taskAssigneeTable.createdAt}, ${taskAssigneeTable.userId})
) + 1`).mapWith(Number);

/**
 * Every (task, assignee, rank) row as a subquery to join on `taskId` when
 * fanning tasks out per assignee (group-by, per-assignee counts). A plain
 * subquery, so the planner can push the outer join condition into it.
 */
export function assigneeRowsSubquery(
  reader: AssigneeReader = db,
  name = "task_assignee_rows",
) {
  return reader
    .select({
      taskId: taskAssigneeTable.taskId,
      userId: taskAssigneeTable.userId,
      rank: qualified(assigneeRankSql).mapWith(Number).as("rank"),
    })
    .from(taskAssigneeTable)
    .as(name);
}

/**
 * The first assignee (the mirror column): sort by assignee on this, joined
 * to the user's name, with unassigned tasks last.
 */
export const firstAssigneeSql = taskTable.userId;

const NAME_ALIAS = "task_assignee_name";
const nameRow = alias(taskAssigneeTable, NAME_ALIAS);
const NAME_USER_ALIAS = "task_assignee_user";
const nameUser = alias(userTable, NAME_USER_ALIAS);

/**
 * The alphabetically smallest assignee name (lower case), NULL when
 * unassigned: the task query's "order by assignee" key.
 */
export const smallestAssigneeNameSql = qualified(sql<string | null>`(
  select min(lower(${nameUser.name}))
  from ${taskAssigneeTable} as ${sql.identifier(NAME_ALIAS)}
  inner join ${userTable} as ${sql.identifier(NAME_USER_ALIAS)}
    on ${nameUser.id} = ${nameRow.userId}
  where ${nameRow.taskId} = ${taskTable.id}
)`);
