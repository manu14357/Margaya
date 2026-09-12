import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { estimateTable } from "../../database/schema";
import {
  EMPTY_COUNTS,
  type GroupCounts,
  pendingOf,
  progressOf,
} from "../../task/progress";
import { groupCountColumns, toGroupCounts } from "../../task/progress-queries";
import { taskGroupSql } from "../../task/scope";
import { nested, type QueryContext } from "../../task-query/context";
import { pointsWeightSql, round2 } from "../metrics";

// Shared by the cycles and modules tabs (B8 §2A.8, §2A.9): one grouped
// statement per tab counts each planning entity's visible member tasks per
// group (B1) and sums their points, with the same counting rules as the
// cycle and module progress routes.

/** Per-entity group counts plus points columns for a grouped select. */
export function planningTallyColumns(context: QueryContext) {
  const weight = pointsWeightSql(context);
  const pointsOf = (group: string | null): SQL<number> =>
    sql<number>`coalesce(sum(${group ? sql`case when ${taskGroupSql} = ${group} then ${weight} end` : weight}), 0)::float8`;
  return {
    ...groupCountColumns(),
    points: pointsOf(null),
    completedPoints: pointsOf("completed"),
    cancelledPoints: pointsOf("cancelled"),
  };
}

export type PlanningTally = {
  counts: GroupCounts;
  points: number;
  completedPoints: number;
  cancelledPoints: number;
};

export function toPlanningTally(
  row: Record<keyof GroupCounts, unknown> & {
    points: unknown;
    completedPoints: unknown;
    cancelledPoints: unknown;
  },
): PlanningTally {
  return {
    counts: toGroupCounts(row),
    points: Number(row.points),
    completedPoints: Number(row.completedPoints),
    cancelledPoints: Number(row.cancelledPoints),
  };
}

export const EMPTY_TALLY: PlanningTally = {
  counts: EMPTY_COUNTS,
  points: 0,
  completedPoints: 0,
  cancelledPoints: 0,
};

/** committed = total − cancelled, pending and progress (D11). */
export function planningNumbers(counts: GroupCounts) {
  return {
    counts,
    committed: counts.total - counts.cancelled,
    pending: pendingOf(counts),
    progress: progressOf(counts),
  };
}

export type PlanningPoints = {
  committedPoints: number | null;
  completedPoints: number | null;
};

export const NO_POINTS: PlanningPoints = {
  committedPoints: null,
  completedPoints: null,
};

/** Live points; null when the project cannot contribute points. */
export function livePoints(
  tally: PlanningTally,
  canContribute: boolean,
): PlanningPoints {
  if (!canContribute) return NO_POINTS;
  return {
    committedPoints: round2(tally.points - tally.cancelledPoints),
    completedPoints: round2(tally.completedPoints),
  };
}

/**
 * True when the row's project has an active points system; correlated to
 * the given project column, for the planning entity selects.
 */
export function hasPointsSystemSql(projectColumn: AnyColumn): SQL<boolean> {
  return nested(sql<boolean>`exists (
    select 1 from ${estimateTable} as ${sql.identifier("analytics_points_system")}
    where ${sql.identifier("analytics_points_system")}.${sql.identifier("project_id")} = ${projectColumn}
      and ${sql.identifier("analytics_points_system")}.${sql.identifier("is_active")}
      and ${sql.identifier("analytics_points_system")}.${sql.identifier("type")} = 'points'
  )`);
}
