// Plain types and constants shared by the estimate schema, controllers and
// the planning features. Kept free of runtime imports so database/schema.ts
// and task/progress.ts can reference them.

export const ESTIMATE_TYPES = ["points", "categories", "time"] as const;

export type EstimateType = (typeof ESTIMATE_TYPES)[number];

/** Points and time systems have numeric values that can be summed. */
export function isNumericEstimateType(type: EstimateType): boolean {
  return type === "points" || type === "time";
}

/** The column groups estimate totals report; triage tasks are never in scope. */
export const ESTIMATE_TOTAL_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type EstimateTotalGroup = (typeof ESTIMATE_TOTAL_GROUPS)[number];

export type EstimateGroupTotals = {
  taskCount: number;
  estimatedTaskCount: number;
  /** Sum of the point values; null unless the system is numeric. */
  total: number | null;
};

export type EstimateDistributionRow = {
  pointId: string;
  value: string;
  position: number;
  taskCount: number;
  completedTaskCount: number;
};

/**
 * Estimate totals over a set of tasks. `enabled` is false while the project's
 * estimates feature is off or no system is active; every number is then 0 or
 * null and `distribution` is empty.
 */
export type EstimateTotals = {
  enabled: boolean;
  estimateId: string | null;
  type: EstimateType | null;
  isNumeric: boolean;
  taskCount: number;
  estimatedTaskCount: number;
  completedTaskCount: number;
  completedEstimatedTaskCount: number;
  total: number | null;
  completed: number | null;
  byGroup: Record<EstimateTotalGroup, EstimateGroupTotals>;
  distribution: EstimateDistributionRow[];
};

/** Why a task's estimate changed without a direct edit. */
export type EstimateChangeReason =
  | "point_deleted"
  | "system_switched"
  | "system_deleted"
  | "task_moved";

/** The `eventData` of an `estimate_changed` activity. */
export type EstimateChangeData = {
  oldPointId: string | null;
  newPointId: string | null;
  oldValue: string | null;
  newValue: string | null;
  oldType: EstimateType | null;
  newType: EstimateType | null;
  reason?: EstimateChangeReason;
};
