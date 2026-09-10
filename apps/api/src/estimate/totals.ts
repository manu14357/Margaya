import { and, asc, count, eq, inArray, type SQL, sql } from "drizzle-orm";
import {
  columnTable,
  estimatePointTable,
  estimateTable,
  projectTable,
  taskTable,
} from "../database/schema";
import type { Reader } from "../task/progress-queries";
import {
  type TaskGroup,
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import {
  ESTIMATE_TOTAL_GROUPS,
  type EstimateGroupTotals,
  type EstimateTotalGroup,
  type EstimateTotals,
  type EstimateType,
  isNumericEstimateType,
} from "./types";

// Estimate totals for the planning features (cycles, modules, analytics) and
// the totals route. Everything aggregates in SQL; no task row is loaded.

export type ActiveEstimate = {
  id: string;
  name: string;
  type: EstimateType;
  points: Array<{
    id: string;
    value: string;
    numericValue: number | null;
    position: number;
  }>;
};

/**
 * The tasks to total: explicit ids, or a subquery selecting a single task id
 * column (for example a cycle's memberships). Either way only visible tasks
 * of the project count.
 */
export type EstimateTaskScope =
  | { kind: "ids"; taskIds: readonly string[] }
  | { kind: "subquery"; sql: SQL };

/** The project's active system with its points in position order, or null. */
export async function getActiveEstimate(
  projectId: string,
  db: Reader,
): Promise<ActiveEstimate | null> {
  const rows = await db
    .select({
      id: estimateTable.id,
      name: estimateTable.name,
      type: estimateTable.type,
      pointId: estimatePointTable.id,
      value: estimatePointTable.value,
      numericValue: estimatePointTable.numericValue,
      position: estimatePointTable.position,
    })
    .from(estimateTable)
    .leftJoin(
      estimatePointTable,
      eq(estimatePointTable.estimateId, estimateTable.id),
    )
    .where(
      and(
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.isActive, true),
      ),
    )
    .orderBy(asc(estimatePointTable.position), asc(estimatePointTable.id));

  const [first] = rows;
  if (!first) return null;
  return {
    id: first.id,
    name: first.name,
    type: first.type,
    points: rows.flatMap((row) =>
      row.pointId !== null && row.value !== null && row.position !== null
        ? [
            {
              id: row.pointId,
              value: row.value,
              numericValue: row.numericValue,
              position: row.position,
            },
          ]
        : [],
    ),
  };
}

/**
 * The active system while the project's estimates feature is on; null when
 * the feature is off, no system is active, or the project doesn't exist.
 */
export async function getEnabledEstimate(
  projectId: string,
  db: Reader,
): Promise<ActiveEstimate | null> {
  const [project] = await db
    .select({ enabled: projectTable.estimatesEnabled })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project?.enabled) return null;
  return getActiveEstimate(projectId, db);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyGroups(numeric: boolean) {
  return Object.fromEntries(
    ESTIMATE_TOTAL_GROUPS.map((group) => [
      group,
      { taskCount: 0, estimatedTaskCount: 0, total: numeric ? 0 : null },
    ]),
  ) as Record<EstimateTotalGroup, EstimateGroupTotals>;
}

/** The totals reported while estimates are off or no system is active. */
export function disabledEstimateTotals(): EstimateTotals {
  return {
    enabled: false,
    estimateId: null,
    type: null,
    isNumeric: false,
    taskCount: 0,
    estimatedTaskCount: 0,
    completedTaskCount: 0,
    completedEstimatedTaskCount: 0,
    total: null,
    completed: null,
    byGroup: emptyGroups(false),
    distribution: [],
  };
}

function scopeCondition(taskScope: EstimateTaskScope): SQL {
  return taskScope.kind === "ids"
    ? inArray(taskTable.id, [...taskScope.taskIds])
    : sql`${taskTable.id} in (${taskScope.sql})`;
}

function isEmptyScope(taskScope: EstimateTaskScope): boolean {
  return taskScope.kind === "ids" && taskScope.taskIds.length === 0;
}

function isTotalGroup(group: TaskGroup | null): group is EstimateTotalGroup {
  return (ESTIMATE_TOTAL_GROUPS as readonly string[]).includes(group ?? "");
}

/**
 * Totals over the visible tasks (not archived, not in triage) of the project
 * in scope, per column group and per point, in one grouped query. Pass
 * `estimate` when the caller already resolved it (null = off or none).
 */
export async function getEstimateTotals({
  projectId,
  taskScope,
  db,
  estimate,
}: {
  projectId: string;
  taskScope: EstimateTaskScope;
  db: Reader;
  estimate?: ActiveEstimate | null;
}): Promise<EstimateTotals> {
  const active =
    estimate === undefined ? await getEnabledEstimate(projectId, db) : estimate;
  if (!active) return disabledEstimateTotals();

  const numeric = isNumericEstimateType(active.type);
  const byGroup = emptyGroups(numeric);
  const points = new Map(active.points.map((point) => [point.id, point]));
  const distribution = new Map(
    active.points.map((point) => [
      point.id,
      { taskCount: 0, completedTaskCount: 0 },
    ]),
  );
  let taskCount = 0;
  let estimatedTaskCount = 0;
  let completedTaskCount = 0;
  let completedEstimatedTaskCount = 0;
  let total = 0;
  let completed = 0;

  if (!isEmptyScope(taskScope)) {
    // The group is an expression; grouping by its alias in an outer query
    // avoids repeating it with fresh parameters, which Postgres rejects.
    const scoped = db
      .select({
        group: sql<TaskGroup | null>`${taskGroupSql}`.as("task_group"),
        pointId: taskTable.estimatePointId,
      })
      .from(taskTable)
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          eq(taskTable.projectId, projectId),
          visibleTaskCondition,
          scopeCondition(taskScope),
        ),
      )
      .as("scoped");

    const rows = await db
      .select({
        group: scoped.group,
        pointId: scoped.pointId,
        taskCount: count(),
      })
      .from(scoped)
      .groupBy(scoped.group, scoped.pointId);

    for (const row of rows) {
      if (!isTotalGroup(row.group)) continue;
      const rowCount = Number(row.taskCount);
      const isCompleted = row.group === "completed";
      const groupTotals = byGroup[row.group];
      groupTotals.taskCount += rowCount;
      taskCount += rowCount;
      if (isCompleted) completedTaskCount += rowCount;

      // A point outside the active system counts as no estimate.
      const point = row.pointId ? points.get(row.pointId) : undefined;
      if (!point) continue;
      groupTotals.estimatedTaskCount += rowCount;
      estimatedTaskCount += rowCount;
      const perPoint = distribution.get(point.id);
      if (perPoint) {
        perPoint.taskCount += rowCount;
        if (isCompleted) perPoint.completedTaskCount += rowCount;
      }
      if (isCompleted) completedEstimatedTaskCount += rowCount;

      if (numeric && point.numericValue !== null) {
        const sum = point.numericValue * rowCount;
        groupTotals.total = (groupTotals.total ?? 0) + sum;
        total += sum;
        if (isCompleted) completed += sum;
      }
    }
  }

  for (const group of ESTIMATE_TOTAL_GROUPS) {
    const groupTotal = byGroup[group].total;
    if (groupTotal !== null) byGroup[group].total = round2(groupTotal);
  }

  return {
    enabled: true,
    estimateId: active.id,
    type: active.type,
    isNumeric: numeric,
    taskCount,
    estimatedTaskCount,
    completedTaskCount,
    completedEstimatedTaskCount,
    total: numeric ? round2(total) : null,
    completed: numeric ? round2(completed) : null,
    byGroup,
    distribution: active.points.map((point) => ({
      pointId: point.id,
      value: point.value,
      position: point.position,
      taskCount: distribution.get(point.id)?.taskCount ?? 0,
      completedTaskCount: distribution.get(point.id)?.completedTaskCount ?? 0,
    })),
  };
}

export type TaskEstimateValue = {
  taskId: string;
  numericValue: number;
  completedAt: Date | null;
};

/**
 * Each visible task in scope that has a point of the active numeric system,
 * with its value and completion time, for points burndown charts. Empty for
 * categories, without an active system, or while the feature is off.
 */
export async function getTaskEstimateValues({
  projectId,
  taskScope,
  db,
  estimate,
}: {
  projectId: string;
  taskScope: EstimateTaskScope;
  db: Reader;
  estimate?: ActiveEstimate | null;
}): Promise<TaskEstimateValue[]> {
  const active =
    estimate === undefined ? await getEnabledEstimate(projectId, db) : estimate;
  if (!active || !isNumericEstimateType(active.type)) return [];
  if (isEmptyScope(taskScope)) return [];

  const rows = await db
    .select({
      taskId: taskTable.id,
      numericValue: estimatePointTable.numericValue,
      completedAt: taskTable.completedAt,
    })
    .from(taskTable)
    .innerJoin(
      estimatePointTable,
      and(
        eq(estimatePointTable.id, taskTable.estimatePointId),
        eq(estimatePointTable.estimateId, active.id),
      ),
    )
    .where(
      and(
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
        scopeCondition(taskScope),
      ),
    );

  return rows.flatMap((row) =>
    row.numericValue === null
      ? []
      : [
          {
            taskId: row.taskId,
            numericValue: row.numericValue,
            completedAt: row.completedAt,
          },
        ],
  );
}

/**
 * Both estimate inputs of a planning progress report (a cycle's or a
 * module's): the totals and each task's value, resolving the system once.
 */
export async function getScopeEstimates(
  db: Reader,
  projectId: string,
  taskScope: EstimateTaskScope,
): Promise<{
  estimates: EstimateTotals;
  estimateValues: Map<string, number>;
}> {
  const estimate = await getEnabledEstimate(projectId, db);
  const estimates = await getEstimateTotals({
    projectId,
    taskScope,
    db,
    estimate,
  });
  const values = await getTaskEstimateValues({
    projectId,
    taskScope,
    db,
    estimate,
  });
  return {
    estimates,
    estimateValues: new Map(
      values.map((value) => [value.taskId, value.numericValue]),
    ),
  };
}
