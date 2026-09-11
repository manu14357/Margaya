import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type db from "../database";
import {
  columnTable,
  labelTable,
  moduleMemberTable,
  moduleTable,
  moduleTaskTable,
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
import { taskColumnJoin, visibleTaskCondition } from "../task/scope";

export type { Reader };
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A link only counts while its task lives in the module's project, so a stale
// link (the task moved away) is invisible to every read.
export const linkTaskJoin = eq(taskTable.id, moduleTaskTable.taskId);
export const linkModuleJoin = and(
  eq(moduleTable.id, moduleTaskTable.moduleId),
  eq(moduleTable.projectId, taskTable.projectId),
) as SQL;

/**
 * Group counts of every module matched by `where` (a condition on the module
 * or link tables), in one grouped query. Modules without visible tasks are
 * absent from the map.
 */
export async function countsByModule(
  reader: Reader,
  where: SQL,
): Promise<Map<string, GroupCounts>> {
  const rows = await reader
    .select({ moduleId: moduleTaskTable.moduleId, ...groupCountColumns() })
    .from(moduleTaskTable)
    .innerJoin(taskTable, linkTaskJoin)
    .innerJoin(moduleTable, linkModuleJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(where, visibleTaskCondition))
    .groupBy(moduleTaskTable.moduleId);

  return new Map(rows.map((row) => [row.moduleId, toGroupCounts(row)]));
}

/** The module's scope: its visible tasks with what progress needs. */
export async function moduleScopeTasks(
  reader: Reader,
  moduleId: string,
): Promise<ScopeTask[]> {
  return reader
    .select(scopeTaskColumns())
    .from(moduleTaskTable)
    .innerJoin(taskTable, linkTaskJoin)
    .innerJoin(moduleTable, linkModuleJoin)
    .leftJoin(columnTable, taskColumnJoin)
    .where(and(eq(moduleTaskTable.moduleId, moduleId), visibleTaskCondition));
}

/** The label copies of the module's scope tasks. */
export async function moduleScopeTaskLabels(
  reader: Reader,
  moduleId: string,
): Promise<ScopeTaskLabel[]> {
  const rows = await reader
    .select(scopeTaskLabelColumns())
    .from(labelTable)
    .innerJoin(moduleTaskTable, eq(moduleTaskTable.taskId, labelTable.taskId))
    .innerJoin(taskTable, linkTaskJoin)
    .innerJoin(moduleTable, linkModuleJoin)
    .where(and(eq(moduleTaskTable.moduleId, moduleId), visibleTaskCondition));

  return toScopeTaskLabels(rows);
}

/** Member ids per module, each list ordered by when the member was added. */
export async function memberIdsByModule(
  reader: Reader,
  moduleIds: string[],
): Promise<Map<string, string[]>> {
  const members = new Map<string, string[]>();
  if (moduleIds.length === 0) return members;

  const rows = await reader
    .select({
      moduleId: moduleMemberTable.moduleId,
      userId: moduleMemberTable.userId,
    })
    .from(moduleMemberTable)
    .where(inArray(moduleMemberTable.moduleId, moduleIds))
    .orderBy(asc(moduleMemberTable.createdAt), asc(moduleMemberTable.id));

  for (const row of rows) {
    const list = members.get(row.moduleId) ?? [];
    list.push(row.userId);
    members.set(row.moduleId, list);
  }
  return members;
}

/**
 * The given ids that are visible tasks of the project. Anything else (other
 * projects, archived, triage, unknown) is left out, which the callers report
 * as ignored.
 */
export async function visibleProjectTaskIds(
  reader: Reader,
  projectId: string,
  taskIds: string[],
): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  const rows = await reader
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
      ),
    );
  return new Set(rows.map((row) => row.id));
}
