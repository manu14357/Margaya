import type { ProgressReport } from "../task/progress";

// Plain types shared by the cycle schema, controllers and helpers. Kept free
// of runtime imports so database/schema.ts can reference them.

export const CYCLE_STATUSES = [
  "draft",
  "upcoming",
  "current",
  "completed",
] as const;

export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/**
 * The report stored in `cycle.progress_snapshot` by the first transfer.
 * Reports frozen before estimates existed lack the estimate fields.
 */
export type CycleProgressSnapshot = Omit<
  ProgressReport,
  "estimates" | "estimateChart"
> &
  Partial<Pick<ProgressReport, "estimates" | "estimateChart">> & {
    /** ISO timestamp of the freeze. */
    frozenAt: string;
  };
