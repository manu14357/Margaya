import { and, eq, gte, isNotNull, lte, ne, type SQL, sql } from "drizzle-orm";
import type db from "../database";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  labelTable,
  taskTable,
} from "../database/schema";
import type { GroupCounts, ScopeTask, ScopeTaskLabel } from "../task/progress";
import {
  groupCountColumns,
  type Reader,
  scopeTaskColumns,
  scopeTaskLabelColumns,
  toGroupCounts,
  toScopeTaskLabels,
} from "../task/progress-queries";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";

export type { Reader };
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A membership only counts while the task still lives in the cycle's project.
// Moving a task detaches it, so this is a guard, not the mechanism.
const membershipTaskJoin = eq(taskTable.id, cycleTaskTable.taskId);
const membershipCycleJoin = and(
  eq(cycleTable.id, cycleTaskTable.cycleId),
  eq(cycleTable.projectId, taskTable.projectId),
) as SQL;

/**
 * Group counts of every cycle matched by `where` (a condition on the cycle
 * or membership tables), in one grouped query. Cycles without visible tasks
 * are absent from the map.
 */
export async function countsByCycle(
  reader: Reader,
  where: SQL,
): Promise<Map<string, GroupCounts>> {
  const rows = await reader
    .select({ cycleId: cycleTaskTable.cycleId, ...groupCountColumns() })
    .from(cycleTaskTable)
    .innerJoin(taskTable, membershipTaskJoin)
    .innerJoin(cycleTable, membershipCycleJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(where, visibleTaskCondition))
    .groupBy(cycleTaskTable.cycleId);

  return new Map(rows.map((row) => [row.cycleId, toGroupCounts(row)]));
}

/** The cycle's scope: its visible member tasks with what progress needs. */
export async function scopeTasks(
  reader: Reader,
  cycleId: string,
): Promise<ScopeTask[]> {
  return reader
    .select(scopeTaskColumns())
    .from(cycleTaskTable)
    .innerJoin(taskTable, membershipTaskJoin)
    .innerJoin(cycleTable, membershipCycleJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(eq(cycleTaskTable.cycleId, cycleId), visibleTaskCondition));
}

/** The label copies of the cycle's scope tasks. */
export async function scopeTaskLabels(
  reader: Reader,
  cycleId: string,
): Promise<ScopeTaskLabel[]> {
  const rows = await reader
    .select(scopeTaskLabelColumns())
    .from(labelTable)
    .innerJoin(cycleTaskTable, eq(cycleTaskTable.taskId, labelTable.taskId))
    .innerJoin(taskTable, membershipTaskJoin)
    .innerJoin(cycleTable, membershipCycleJoin)
    .where(and(eq(cycleTaskTable.cycleId, cycleId), visibleTaskCondition));

  return toScopeTaskLabels(rows);
}

/** Ids of the scope tasks that are not finished (backlog, not started, started). */
export async function pendingScopeTaskIds(
  reader: Reader,
  cycleId: string,
): Promise<string[]> {
  const rows = await reader
    .select({ id: taskTable.id })
    .from(cycleTaskTable)
    .innerJoin(taskTable, membershipTaskJoin)
    .innerJoin(cycleTable, membershipCycleJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(cycleTaskTable.cycleId, cycleId),
        visibleTaskCondition,
        sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`,
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Another dated cycle of the project (archived ones included) whose
 * inclusive range overlaps the given one, or null.
 */
export async function findOverlappingCycle(
  reader: Reader,
  {
    projectId,
    startDate,
    endDate,
    excludeId,
  }: {
    projectId: string;
    startDate: string;
    endDate: string;
    excludeId?: string;
  },
): Promise<{ id: string; name: string } | null> {
  const [row] = await reader
    .select({ id: cycleTable.id, name: cycleTable.name })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.projectId, projectId),
        isNotNull(cycleTable.startDate),
        isNotNull(cycleTable.endDate),
        lte(cycleTable.startDate, endDate),
        gte(cycleTable.endDate, startDate),
        excludeId ? ne(cycleTable.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}
