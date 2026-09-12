import { and, gte, lt, sql } from "drizzle-orm";
import { columnTable, taskTable } from "../../database/schema";
import { taskColumnJoin, taskGroupSql } from "../../task/scope";
import { addDays, toInstantRange } from "../../task-query/dates";
import { rangeBuckets } from "../buckets";
import { bucketKeySql, localDaySql } from "../dimensions";
import { loadPointsProjectIds, round2, weightSql } from "../metrics";
import type { AnalyticsTrendResult } from "../response";
import type { AnalyticsTrendRequest } from "../schema";
import {
  type AnalyticsCaller,
  analyticsRead,
  assertRunnableFilters,
  loadTaskSetContext,
  taskSetCondition,
} from "../scope";

// Created vs completed (AN3, B8 §2A.6). Completed counts completion events:
// a task counts in the bucket of its completedAt while it is still in the
// completed group (K9), so reopening removes it retroactively. One
// statement; the range condition lets the per-project created_at and
// completed_at indexes drive it.

type TrendRow = { series: "created" | "completed"; k: string; v: number };

/**
 * AN3 for a caller that passed workspace access, `analytics:read` and
 * `task:read`. 400 for a bad range or filter tree, 404 for a project
 * outside the workspace, 503 on the statement timeout.
 */
export async function queryAnalyticsTrend(
  request: AnalyticsTrendRequest,
  caller: AnalyticsCaller,
): Promise<AnalyticsTrendResult> {
  assertRunnableFilters(request.filters);
  const weekStartsOn = request.context?.weekStartsOn ?? 0;
  const windows = rangeBuckets(
    request.from,
    request.to,
    request.bucket,
    weekStartsOn,
  );
  const metric = request.metric ?? "taskCount";

  return analyticsRead(async (tx) => {
    const context = await loadTaskSetContext(tx, caller, request);
    const pointsProjectIds = await loadPointsProjectIds(tx, context);
    const range = toInstantRange(
      { from: request.from, until: addDays(request.to, 1) },
      context.timeZone,
    );
    const start = range.gte as Date;
    const end = range.lt as Date;

    const createdIn = and(
      gte(taskTable.createdAt, start),
      lt(taskTable.createdAt, end),
    );
    const completedIn = and(
      sql`${taskGroupSql} = 'completed'`,
      gte(taskTable.completedAt, start),
      lt(taskTable.completedAt, end),
    );
    const bucketOf = (column: string) =>
      bucketKeySql(
        localDaySql(sql`${sql.identifier(column)}`, context.timeZone),
        request.bucket,
        weekStartsOn,
      );

    const { rows } = await tx.execute<TrendRow>(sql`
      with scoped as (
        select ${taskTable.createdAt} as created_at, ${taskTable.completedAt} as completed_at,
          coalesce(${createdIn}, false) as created_in,
          coalesce(${completedIn}, false) as completed_in,
          ${weightSql(metric, context)} as w
        from ${taskTable} left join ${columnTable} on ${taskColumnJoin}
        where ${taskSetCondition(context, request)} and (${createdIn} or ${completedIn})
      )
      select 'created' as series, k, sum(w)::float8 as v
        from (select ${bucketOf("created_at")} as k, w from scoped where created_in) as created
        group by k
      union all
      select 'completed', k, sum(w)::float8
        from (select ${bucketOf("completed_at")} as k, w from scoped where completed_in) as completed
        group by k`);

    const created = new Map<string, number>();
    const completed = new Map<string, number>();
    for (const row of rows) {
      (row.series === "created" ? created : completed).set(
        row.k,
        Number(row.v),
      );
    }

    const series = windows.map((window) => ({
      ...window,
      created: round2(created.get(window.start) ?? 0),
      completed: round2(completed.get(window.start) ?? 0),
    }));
    const createdTotal = round2(
      series.reduce((sum, point) => sum + point.created, 0),
    );
    const completedTotal = round2(
      series.reduce((sum, point) => sum + point.completed, 0),
    );

    return {
      from: request.from,
      to: request.to,
      bucket: request.bucket,
      metric,
      today: context.today,
      series,
      totals: {
        created: createdTotal,
        completed: completedTotal,
        net: round2(createdTotal - completedTotal),
      },
      pointsProjectIds,
    };
  });
}
