import { type ColumnLike, taskGroupOf } from "@/lib/column-groups";
import type { EstimateTotals } from "@/types/estimate";
import { type EstimateType, isNumericEstimateType } from "./values";

// The web twin of the API's estimate totals: the same shape, computed from
// tasks a screen already holds (board data) instead of calling the API.

type TotalsGroup = keyof EstimateTotals["byGroup"];

const TOTALS_GROUPS: readonly TotalsGroup[] = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
];

type EstimateLike = {
  id: string;
  type: EstimateType;
  points: ReadonlyArray<{
    id: string;
    value: string;
    numericValue: number | null;
    position: number;
  }>;
};

export type EstimateValueEntry = {
  value: string;
  numericValue: number | null;
  position: number;
};

/** Each point of the system by id, for per-task lookups. */
export function getEstimateValueMap(
  estimate: EstimateLike | null | undefined,
): Map<string, EstimateValueEntry> {
  return new Map(
    (estimate?.points ?? []).map((point) => [
      point.id,
      {
        value: point.value,
        numericValue: point.numericValue,
        position: point.position,
      },
    ]),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isTotalsGroup(group: string | null): group is TotalsGroup {
  return (TOTALS_GROUPS as readonly (string | null)[]).includes(group);
}

function emptyGroups(numeric: boolean): EstimateTotals["byGroup"] {
  const group = () => ({
    taskCount: 0,
    estimatedTaskCount: 0,
    total: numeric ? 0 : null,
  });
  return {
    backlog: group(),
    unstarted: group(),
    started: group(),
    completed: group(),
    cancelled: group(),
  };
}

/** What the totals say while estimates are off or no system is active. */
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

/**
 * Totals over visible tasks (not archived, not in triage), grouped by their
 * column's group. A point outside the system counts as no estimate. Sums
 * are rounded to 2 decimals; time sums are minutes.
 */
export function computeEstimateTotals(
  tasks: ReadonlyArray<{ status: string; estimatePointId?: string | null }>,
  estimate: EstimateLike | null | undefined,
  columns: readonly ColumnLike[],
  featureEnabled: boolean,
): EstimateTotals {
  if (!featureEnabled || !estimate) return disabledEstimateTotals();

  const numeric = isNumericEstimateType(estimate.type);
  const points = getEstimateValueMap(estimate);
  const byGroup = emptyGroups(numeric);
  const perPoint = new Map(
    estimate.points.map((point) => [
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

  for (const task of tasks) {
    const group = taskGroupOf(task.status, columns);
    if (!isTotalsGroup(group)) continue;
    const isCompleted = group === "completed";
    taskCount++;
    byGroup[group].taskCount++;
    if (isCompleted) completedTaskCount++;

    const point = task.estimatePointId
      ? points.get(task.estimatePointId)
      : undefined;
    if (!point || !task.estimatePointId) continue;
    estimatedTaskCount++;
    byGroup[group].estimatedTaskCount++;
    if (isCompleted) completedEstimatedTaskCount++;
    const counts = perPoint.get(task.estimatePointId);
    if (counts) {
      counts.taskCount++;
      if (isCompleted) counts.completedTaskCount++;
    }

    if (numeric && point.numericValue !== null) {
      byGroup[group].total = (byGroup[group].total ?? 0) + point.numericValue;
      total += point.numericValue;
      if (isCompleted) completed += point.numericValue;
    }
  }

  for (const group of TOTALS_GROUPS) {
    const groupTotal = byGroup[group].total;
    if (groupTotal !== null) byGroup[group].total = round2(groupTotal);
  }

  return {
    enabled: true,
    estimateId: estimate.id,
    type: estimate.type,
    isNumeric: numeric,
    taskCount,
    estimatedTaskCount,
    completedTaskCount,
    completedEstimatedTaskCount,
    total: numeric ? round2(total) : null,
    completed: numeric ? round2(completed) : null,
    byGroup,
    distribution: [...estimate.points]
      .sort((a, b) => a.position - b.position)
      .map((point) => ({
        pointId: point.id,
        value: point.value,
        position: point.position,
        taskCount: perPoint.get(point.id)?.taskCount ?? 0,
        completedTaskCount: perPoint.get(point.id)?.completedTaskCount ?? 0,
      })),
  };
}
