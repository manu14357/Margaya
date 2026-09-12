import { and, eq, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  estimatePointTable,
  estimateTable,
  taskTable,
} from "../database/schema";
import type { TaskReadDatabase } from "../task/bounded-read";
import { featureOn, type QueryContext, textArray } from "../task-query/context";

// Metric weights (B8 §2A.2). A task weighs 1 for task counts. For estimate
// points it weighs its point's numeric value, but only while its project has
// estimates on and the point belongs to the project's active system of type
// points; otherwise 0 (K3, K10). Time and category systems never add points,
// and nothing casts text to a number.

export const ANALYTICS_METRICS = ["taskCount", "estimatePoints"] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

const weightPoint = alias(estimatePointTable, "analytics_weight_point");
const weightEstimate = alias(estimateTable, "analytics_weight_estimate");

/** The task's points (0 when it cannot contribute), correlated to `task`. */
export function pointsWeightSql(context: QueryContext): SQL {
  return sql`(case when ${featureOn("estimates", context)} and ${taskTable.estimatePointId} is not null then coalesce((
    select ${weightPoint.numericValue}
    from ${estimatePointTable} as ${sql.identifier("analytics_weight_point")}
    inner join ${estimateTable} as ${sql.identifier("analytics_weight_estimate")}
      on ${weightEstimate.id} = ${weightPoint.estimateId}
      and ${weightEstimate.projectId} = ${taskTable.projectId}
      and ${weightEstimate.isActive}
      and ${weightEstimate.type} = 'points'
    where ${weightPoint.id} = ${taskTable.estimatePointId}
  ), 0) else 0 end)`;
}

/** The weight w(t) of a metric as a double precision expression. */
export function weightSql(metric: AnalyticsMetric, context: QueryContext): SQL {
  return metric === "estimatePoints"
    ? sql`(${pointsWeightSql(context)})::float8`
    : sql`1::float8`;
}

/**
 * Scope projects that can contribute points: estimates on and an active
 * system of type points. One statement; none when no project has
 * estimates on.
 */
export async function loadPointsProjectIds(
  tx: TaskReadDatabase,
  context: QueryContext,
): Promise<string[]> {
  const candidates = context.featureProjectIds.estimates;
  if (candidates.length === 0) return [];
  const rows = await tx
    .select({ projectId: estimateTable.projectId })
    .from(estimateTable)
    .where(
      and(
        sql`${estimateTable.projectId} = any(${textArray(candidates)})`,
        eq(estimateTable.isActive, true),
        eq(estimateTable.type, "points"),
      ),
    );
  const found = new Set(rows.map((row) => row.projectId));
  return context.projectIds.filter((id) => found.has(id));
}

/** Rounds a points sum for serialization (B6: two decimals). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
