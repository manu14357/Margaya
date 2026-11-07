import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  INVALID_DATE,
  INVALID_DATE_RANGE,
  MAX_RANGE_DAYS,
  TOO_MANY_BUCKETS,
} from "../../analytics/buckets";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
} from "../../analytics/scope";
import { projectTable, taskTable, timeEntryTable } from "../../database/schema";
import { projectFeatureEnabledCondition } from "../../project/features";
import { inTriageColumnSqlOf } from "../../task/scope";
import { textArray } from "../../task-query/context";
import {
  addDays,
  isValidDay,
  startOfZonedDay,
  toInstantRange,
} from "../../task-query/dates";
import { MetaStore } from "../../task-query/hydrate";

// Totals by person and by project over the analytics scope, from one grouped
// statement. Time counts on the day an entry started in the requested zone.
// A running entry has no duration yet, so it counts as running, never as time.

type TimeReportQuery = {
  projectIds?: string[];
  timeZone?: string;
  from: string;
  to: string;
};

function assertValidRange(from: string, to: string) {
  if (!isValidDay(from) || !isValidDay(to)) {
    throw new HTTPException(400, { message: INVALID_DATE });
  }
  if (from > to) throw new HTTPException(400, { message: INVALID_DATE_RANGE });
  const span =
    (startOfZonedDay(to, "UTC").getTime() -
      startOfZonedDay(from, "UTC").getTime()) /
    86_400_000;
  if (span > MAX_RANGE_DAYS) {
    throw new HTTPException(400, { message: TOO_MANY_BUCKETS });
  }
}

type Tally = { seconds: number; entryCount: number };

function add(tallies: Map<string, Tally>, key: string, row: Tally) {
  const tally = tallies.get(key) ?? { seconds: 0, entryCount: 0 };
  tally.seconds += row.seconds;
  tally.entryCount += row.entryCount;
  tallies.set(key, tally);
}

const FORMER_MEMBER = "";

async function getTimeReport(caller: AnalyticsCaller, query: TimeReportQuery) {
  assertValidRange(query.from, query.to);

  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds: query.projectIds,
      timeZone: query.timeZone,
    });
    const range = toInstantRange(
      { from: query.from, until: addDays(query.to, 1) },
      context.timeZone,
    );

    const rows =
      context.projectIds.length === 0
        ? []
        : await tx
            .select({
              projectId: taskTable.projectId,
              userId: timeEntryTable.userId,
              seconds: sql<number>`coalesce(sum(${timeEntryTable.duration}) filter (where ${timeEntryTable.endTime} is not null), 0)::float8`,
              entryCount: sql<number>`(count(*) filter (where ${timeEntryTable.endTime} is not null))::int`,
              runningCount: sql<number>`(count(*) filter (where ${timeEntryTable.endTime} is null))::int`,
            })
            .from(timeEntryTable)
            .innerJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
            .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
            .where(
              and(
                sql`${taskTable.projectId} = any(${textArray(context.projectIds)})`,
                projectFeatureEnabledCondition("timeTracking"),
                isNull(taskTable.deletedAt),
                sql`not ${inTriageColumnSqlOf(taskTable)}`,
                range.gte
                  ? gte(timeEntryTable.startTime, range.gte)
                  : undefined,
                range.lt ? lt(timeEntryTable.startTime, range.lt) : undefined,
              ),
            )
            .groupBy(taskTable.projectId, timeEntryTable.userId);

    const store = new MetaStore(tx, context);
    await store.loadUsers(rows.flatMap((row) => row.userId ?? []));

    const people = new Map<string, Tally>();
    const projects = new Map<string, Tally>();
    let totalSeconds = 0;
    let entryCount = 0;
    let runningCount = 0;
    for (const row of rows) {
      runningCount += row.runningCount;
      if (row.entryCount === 0) continue;
      totalSeconds += row.seconds;
      entryCount += row.entryCount;
      // Someone no longer in the workspace is not named, only counted.
      const known = row.userId && store.users.has(row.userId);
      add(people, known && row.userId ? row.userId : FORMER_MEMBER, row);
      add(projects, row.projectId, row);
    }

    const byPerson = [...people].map(([userId, tally]) => {
      const user = store.users.get(userId);
      return {
        userId: userId === FORMER_MEMBER ? null : userId,
        name: user?.name ?? null,
        image: user?.image ?? null,
        ...tally,
      };
    });
    const byProject = [...projects].map(([projectId, tally]) => {
      const project = context.projectById.get(projectId);
      return {
        projectId,
        name: project?.name ?? "",
        slug: project?.slug ?? "",
        icon: project?.icon ?? null,
        ...tally,
      };
    });
    const mostFirst = (a: Tally, b: Tally) => b.seconds - a.seconds;

    return {
      from: query.from,
      to: query.to,
      timeZone: context.timeZone,
      totalSeconds,
      entryCount,
      runningCount,
      byPerson: byPerson.sort(mostFirst),
      byProject: byProject.sort(mostFirst),
    };
  });
}

export default getTimeReport;
