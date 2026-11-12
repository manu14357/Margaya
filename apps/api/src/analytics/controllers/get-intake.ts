import { and, count, gte, lt, type SQL, sql } from "drizzle-orm";
import { intakeItemTable } from "../../database/schema";
import { effectiveStatusSql } from "../../intake/queries";
import {
  CLOSED_INTAKE_STATUSES,
  INTAKE_STATUSES,
  type IntakeStatus,
} from "../../intake/status";
import { textArray } from "../../task-query/context";
import {
  addDays,
  toInstantRange,
  type WeekStart,
} from "../../task-query/dates";
import { type DateBucket, rangeBuckets } from "../buckets";
import { bucketKeySql, localDaySql } from "../dimensions";
import type { AnalyticsIntake } from "../response";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
  projectsMeta,
  projectsWithFeature,
} from "../scope";

// The intake tab (AN6, B8 §2A.10): counts by effective status (an expired
// snooze reads as pending), requests over time, the median time to triage
// and sources; three statements after the scope. Triaged series count an
// item once, in its current decision, at its latest decision time.

type StatusCounts = Record<IntakeStatus, number>;
type IntakeInstant =
  | typeof intakeItemTable.createdAt
  | typeof intakeItemTable.triagedAt;

function emptyCounts(): StatusCounts {
  return Object.fromEntries(
    INTAKE_STATUSES.map((status) => [status, 0]),
  ) as StatusCounts;
}

function roundHours(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

type SeriesRow = { kind: string; k: string; n: number };
type MedianRow = {
  projectId: string | null;
  overall: number;
  median: number | null;
};

export async function getAnalyticsIntake(
  caller: AnalyticsCaller,
  query: {
    projectIds?: string[];
    timeZone?: string;
    from: string;
    to: string;
    bucket: DateBucket;
    weekStartsOn: WeekStart;
  },
): Promise<AnalyticsIntake> {
  const windows = rangeBuckets(
    query.from,
    query.to,
    query.bucket,
    query.weekStartsOn,
  );

  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds: query.projectIds,
      timeZone: query.timeZone,
      weekStartsOn: query.weekStartsOn,
    });
    const enabled = projectsWithFeature(context, "intake");
    const withByProject = context.projectIds.length !== 1;
    const counts = emptyCounts();
    const perProject = new Map(enabled.map((id) => [id, emptyCounts()]));
    const submitted = new Map<string, number>();
    const decided = new Map<string, number>();
    const bySource = { in_app: 0, api: 0, public_board: 0, email: 0, form: 0 };
    const medians = new Map<string | null, number | null>();

    if (enabled.length > 0) {
      const inEnabled = sql`${intakeItemTable.projectId} = any(${textArray(enabled)})`;
      const { gte: start, lt: end } = toInstantRange(
        { from: query.from, until: addDays(query.to, 1) },
        context.timeZone,
      );
      const within = (column: IntakeInstant) =>
        and(gte(column, start as Date), lt(column, end as Date)) as SQL;
      const closed = sql`${intakeItemTable.status} in (${sql.join(
        CLOSED_INTAKE_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})`;
      const bucketOf = (column: IntakeInstant) =>
        bucketKeySql(
          localDaySql(column, context.timeZone, true),
          query.bucket,
          query.weekStartsOn,
        );

      const statusRows = await tx
        .select({
          projectId: intakeItemTable.projectId,
          status: effectiveStatusSql,
          count: count(),
        })
        .from(intakeItemTable)
        .where(inEnabled)
        .groupBy(intakeItemTable.projectId, effectiveStatusSql);
      for (const row of statusRows) {
        const n = Number(row.count);
        if (!(row.status in counts)) continue;
        counts[row.status] += n;
        const entry = perProject.get(row.projectId);
        if (entry) entry[row.status] += n;
      }

      const { rows: seriesRows } = await tx.execute<SeriesRow>(sql`
        select 'submitted' as kind, k, count(*)::int as n
          from (select ${bucketOf(intakeItemTable.createdAt)} as k from ${intakeItemTable}
            where ${inEnabled} and ${within(intakeItemTable.createdAt)}) as submitted
          group by k
        union all
        select status, k, count(*)::int
          from (select ${intakeItemTable.status} as status, ${bucketOf(intakeItemTable.triagedAt)} as k
            from ${intakeItemTable}
            where ${inEnabled} and ${closed} and ${within(intakeItemTable.triagedAt)}) as decided
          group by status, k
        union all
        select 'source', ${intakeItemTable.source}, count(*)::int from ${intakeItemTable}
          where ${inEnabled} and ${within(intakeItemTable.createdAt)}
          group by ${intakeItemTable.source}`);
      for (const row of seriesRows) {
        const n = Number(row.n);
        if (row.kind === "submitted") submitted.set(row.k, n);
        else if (row.kind === "source") {
          if (row.k in bySource) bySource[row.k as keyof typeof bySource] += n;
        } else decided.set(`${row.kind}\u0000${row.k}`, n);
      }

      const { rows: medianRows } = await tx.execute<MedianRow>(sql`
        select ${intakeItemTable.projectId} as "projectId",
          grouping(${intakeItemTable.projectId})::int as overall,
          percentile_cont(0.5) within group (
            order by extract(epoch from (${intakeItemTable.triagedAt} - ${intakeItemTable.createdAt})) / 3600.0
          ) as median
        from ${intakeItemTable}
        where ${inEnabled} and ${closed} and ${within(intakeItemTable.triagedAt)}
        group by grouping sets ((${intakeItemTable.projectId}), ())`);
      for (const row of medianRows) {
        const median = row.median === null ? null : Number(row.median);
        medians.set(Number(row.overall) === 1 ? null : row.projectId, median);
      }
    }

    const decidedIn = (status: string, start: string) =>
      decided.get(`${status}\u0000${start}`) ?? 0;

    return {
      today: context.today,
      from: query.from,
      to: query.to,
      bucket: query.bucket,
      enabledProjectIds: enabled,
      counts,
      series: windows.map((window) => ({
        ...window,
        submitted: submitted.get(window.start) ?? 0,
        accepted: decidedIn("accepted", window.start),
        declined: decidedIn("declined", window.start),
        duplicate: decidedIn("duplicate", window.start),
      })),
      medianHoursToTriage: roundHours(medians.get(null) ?? null),
      bySource,
      byProject: withByProject
        ? enabled.map((projectId) => ({
            projectId,
            ...(perProject.get(projectId) ?? emptyCounts()),
            medianHoursToTriage: roundHours(medians.get(projectId) ?? null),
          }))
        : null,
      meta: { projects: projectsMeta(context, enabled) },
    };
  });
}
