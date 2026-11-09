import { type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { columnTable, taskTable } from "../../database/schema";
import type { TaskReadDatabase } from "../../task/bounded-read";
import { taskColumnJoin } from "../../task/scope";
import {
  type QueryContext,
  UNKNOWN_CUSTOM_FIELD,
} from "../../task-query/context";
import type { GroupKeyExpression } from "../../task-query/group";
import {
  customFieldIdOfKey,
  isCustomFieldDisplayKey,
} from "../../task-query/schema";
import {
  type AnalyticsDimension,
  dimensionInfo,
  dimensionKeySql,
  isDateDimension,
  NONE_KEY,
} from "../dimensions";
import { type ChartAggregate, shapeChart } from "../fold";
import { ChartMeta } from "../meta";
import {
  type ChartMetric,
  loadPointsProjectIds,
  round2,
  weightSql,
} from "../metrics";
import type { AnalyticsChartResult } from "../response";
import {
  type AnalyticsChartRequest,
  DATES_ONLY_ON_X,
  FIELD_NOT_A_DIMENSION,
  FIELD_NOT_SUMMABLE,
  SEGMENT_MUST_DIFFER,
  STATUS_NEEDS_ONE_PROJECT,
} from "../schema";
import {
  type AnalyticsCaller,
  analyticsRead,
  assertRunnableFilters,
  loadTaskSetContext,
  taskSetCondition,
} from "../scope";

// The custom chart (AN2, B8 §2A.3, §3.6): one aggregate statement over the
// task set, whatever the number of tasks, buckets or segments. Each key CTE
// holds one row per (task, key), so plain count(*) and sum(w) are already
// distinct per bucket, per segment and per cell.

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

type AggregateRow = {
  kind: "b" | "s" | "c" | "t";
  x: string | null;
  s: string | null;
  n: number;
  v: number | null;
};

/** One row per (task, key); many-valued keys fan out, empty means none. */
function keyRows(column: "xk" | "sk", expression: GroupKeyExpression): SQL {
  const key = sql.identifier(column);
  return expression.many
    ? sql`select id, w, k from scoped cross join lateral unnest(coalesce(nullif(${key}, '{}'::text[]), array[${NONE_KEY}::text])) as keyed(k)`
    : sql`select id, w, ${key} as k from scoped`;
}

async function aggregateChart(
  tx: TaskReadDatabase,
  {
    condition,
    weight,
    x,
    segment,
  }: {
    condition: SQL;
    weight: SQL;
    x: GroupKeyExpression;
    segment: GroupKeyExpression | null;
  },
): Promise<ChartAggregate> {
  const scoped = sql`select ${taskTable.id} as id, ${weight} as w, ${x.sql} as xk${segment ? sql`, ${segment.sql} as sk` : sql``}
    from ${taskTable} left join ${columnTable} on ${taskColumnJoin}
    where ${condition}`;
  const segmentParts = segment
    ? {
        cte: sql`, seg_keys as (${keyRows("sk", segment)})`,
        selects: sql`
          union all select 's', null, k, count(*)::int, sum(w)::float8 from seg_keys group by k
          union all select 'c', xr.k, sr.k, count(*)::int, sum(xr.w)::float8
            from x_keys as xr inner join seg_keys as sr on sr.id = xr.id
            group by xr.k, sr.k`,
      }
    : { cte: sql``, selects: sql`` };

  const { rows } = await tx.execute<AggregateRow>(sql`
    with scoped as (${scoped}),
    x_keys as (${keyRows("xk", x)})${segmentParts.cte}
    select 'b' as kind, k as x, null::text as s, count(*)::int as n, sum(w)::float8 as v
      from x_keys group by k${segmentParts.selects}
    union all select 't', null, null, count(*)::int, coalesce(sum(w), 0)::float8 from scoped`);

  const aggregate: ChartAggregate = {
    buckets: new Map(),
    segments: new Map(),
    cells: new Map(),
    total: { value: 0, taskCount: 0 },
  };
  for (const row of rows) {
    const tally = { value: Number(row.v ?? 0), taskCount: Number(row.n) };
    if (row.kind === "t") aggregate.total = tally;
    else if (row.kind === "b") aggregate.buckets.set(row.x ?? NONE_KEY, tally);
    else if (row.kind === "s") aggregate.segments.set(row.s ?? NONE_KEY, tally);
    else {
      const x = row.x ?? NONE_KEY;
      const cells = aggregate.cells.get(x) ?? new Map<string, number>();
      cells.set(row.s ?? NONE_KEY, tally.value);
      aggregate.cells.set(x, cells);
    }
  }
  return aggregate;
}

/** Custom fields the chart groups by or sums, by their keys. */
function chartFieldIds(keys: ReadonlyArray<AnalyticsDimension | ChartMetric>) {
  return keys.filter(isCustomFieldDisplayKey).map(customFieldIdOfKey);
}

/**
 * 400 unless each charted field is in a scope project: a dropdown as a
 * dimension, a number as the metric.
 */
function assertChartFields(
  context: QueryContext,
  dimensions: readonly AnalyticsDimension[],
  metric: ChartMetric,
) {
  const typeOf = (key: string) => {
    const field = context.displayFields?.get(key);
    if (!field) badRequest(UNKNOWN_CUSTOM_FIELD);
    return field.type;
  };
  for (const fieldId of chartFieldIds(dimensions)) {
    if (typeOf(fieldId) !== "dropdown") badRequest(FIELD_NOT_A_DIMENSION);
  }
  for (const fieldId of chartFieldIds([metric])) {
    if (typeOf(fieldId) !== "number") badRequest(FIELD_NOT_SUMMABLE);
  }
}

/**
 * AN2 for a caller that passed workspace access, `analytics:read` and
 * `task:read`. 400 for an invalid combination or filter tree, 404 for a
 * project outside the workspace, 503 on the statement timeout.
 */
export async function queryAnalyticsChart(
  request: AnalyticsChartRequest,
  caller: AnalyticsCaller,
): Promise<AnalyticsChartResult> {
  assertRunnableFilters(request.filters);
  const xAxis = request.xAxis;
  const segment = request.segment ?? null;
  if (segment !== null) {
    if (segment === xAxis) badRequest(SEGMENT_MUST_DIFFER);
    if (isDateDimension(segment)) badRequest(DATES_ONLY_ON_X);
  }
  const metric = request.metric ?? "taskCount";
  const dateBucket = request.dateBucket ?? "month";
  const includeNone = request.includeNone ?? true;

  const dimensions = segment === null ? [xAxis] : [xAxis, segment];
  return analyticsRead(async (tx) => {
    const context = await loadTaskSetContext(
      tx,
      caller,
      request,
      chartFieldIds([...dimensions, metric]),
    );
    assertChartFields(context, dimensions, metric);
    if (
      (xAxis === "status" || segment === "status") &&
      context.projectIds.length !== 1
    ) {
      badRequest(STATUS_NEEDS_ONE_PROJECT);
    }
    const pointsProjectIds = await loadPointsProjectIds(tx, context);

    const aggregate = await aggregateChart(tx, {
      condition: taskSetCondition(context, request),
      weight: weightSql(metric, context),
      x: dimensionKeySql(xAxis, context, dateBucket),
      segment: segment ? dimensionKeySql(segment, context, dateBucket) : null,
    });

    const meta = new ChartMeta(tx, context);
    await meta.load([
      { dimension: xAxis, keys: [...aggregate.buckets.keys()] },
      ...(segment
        ? [{ dimension: segment, keys: [...aggregate.segments.keys()] }]
        : []),
    ]);
    const shaped = shapeChart(aggregate, {
      xAxis,
      segment,
      includeNone,
      dateBucket,
      lookup: meta.lookup,
    });

    return {
      xAxis,
      segment,
      metric,
      dateBucket: isDateDimension(xAxis) ? dateBucket : null,
      today: context.today,
      totalCount: aggregate.total.taskCount,
      totalValue: round2(aggregate.total.value),
      progress: shaped.progress,
      noneCount: shaped.noneCount,
      buckets: shaped.buckets,
      segments: shaped.segments,
      truncated: shaped.truncated,
      multiValued: {
        x: dimensionInfo(xAxis).many,
        segment: segment ? dimensionInfo(segment).many : false,
      },
      pointsProjectIds,
      meta: meta.build([
        { dimension: xAxis, keys: shaped.buckets.map((bucket) => bucket.key) },
        ...(segment
          ? [
              {
                dimension: segment,
                keys: shaped.segments.map((entry) => entry.key),
              },
            ]
          : []),
      ]),
    };
  });
}
