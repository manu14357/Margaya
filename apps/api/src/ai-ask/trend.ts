import { and, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import db from "../database";
import {
  columnTable,
  cycleTaskTable,
  projectTable,
  taskTable,
} from "../database/schema";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { addDays, startOfWeek } from "../task-query/dates";
import { startOfLocalDayUtc, todayInTimezone } from "../utils/zoned-date";
import type { AskItem } from "./retrieve";

// Time-series facts for trend questions ("created vs completed per week",
// "burn-up of Sprint 4"): tasks created and completed per week (last 12
// weeks) or per day (last 30 days), and a cycle's burn-up. Counted over the
// tasks the caller can see, in the workspace's time zone, like the other
// facts (facts.ts); never cited.

export const TREND_WEEKS = 12;
export const TREND_DAYS = 30;
/** Days of a cycle's burn-up (the latest ones when the cycle is longer). */
export const MAX_BURN_DAYS = 60;

export type TrendUnit = "day" | "week";

export type TrendBucket = { label: string; created: number; completed: number };

export type BurnDay = { label: string; completed: number; remaining: number };

export type CycleBurn = {
  name: string;
  startDate: string;
  endDate: string | null;
  total: number;
  days: BurnDay[];
};

/** Per day when the question says so ("daily", "last 30 days"), else per week. */
export function trendUnitOf(question: string): TrendUnit {
  return /\b(day|days|daily|per day|each day|by day)\b/i.test(question)
    ? "day"
    : "week";
}

/** The buckets' first days (local), oldest first, and the end bound day. */
export function trendBuckets(
  today: string,
  unit: TrendUnit,
): { starts: string[]; end: string } {
  const end = addDays(today, 1);
  if (unit === "day") {
    return {
      starts: Array.from({ length: TREND_DAYS }, (_, i) =>
        addDays(today, i - (TREND_DAYS - 1)),
      ),
      end,
    };
  }
  const thisWeek = startOfWeek(today, 1);
  return {
    starts: Array.from({ length: TREND_WEEKS }, (_, i) =>
      addDays(thisWeek, (i - (TREND_WEEKS - 1)) * 7),
    ),
    end,
  };
}

const completedSql = sql`${taskGroupSql} = 'completed'`;

function countBetween(
  column: typeof taskTable.createdAt | typeof taskTable.completedAt,
  from: Date,
  to: Date,
  extra?: SQL,
): SQL<number> {
  const range = and(gte(column, from), lt(column, to)) as SQL;
  const condition = extra ? sql`${extra} and ${range}` : range;
  return sql<number>`(count(*) filter (where ${condition}))::int`.mapWith(
    Number,
  );
}

/** Created and completed per bucket for these projects (in the AI scope). */
export async function loadTrend(input: {
  scope: AiScope;
  projectIds: readonly string[];
  now: Date;
  timeZone: string;
  unit: TrendUnit;
}): Promise<TrendBucket[]> {
  const projectIds = input.projectIds.filter((id) =>
    input.scope.projectIds.has(id),
  );
  if (projectIds.length === 0 || !input.scope.can.readTasks) return [];
  const today = todayInTimezone(input.timeZone, input.now);
  const { starts, end } = trendBuckets(today, input.unit);
  const bounds = [...starts, end].map((day) =>
    startOfLocalDayUtc(day, input.timeZone),
  );
  const columns: Record<string, SQL<number>> = {};
  starts.forEach((_, i) => {
    const from = bounds[i] as Date;
    const to = bounds[i + 1] as Date;
    columns[`c${i}`] = countBetween(taskTable.createdAt, from, to);
    columns[`d${i}`] = countBetween(
      taskTable.completedAt,
      from,
      to,
      completedSql,
    );
  });
  const [row] = await db
    .select(columns)
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(taskTable.projectId, projectIds),
        eq(projectTable.workspaceId, input.scope.workspaceId),
        visibleTaskCondition,
      ),
    );
  const values = (row ?? {}) as Record<string, unknown>;
  return starts.map((label, i) => ({
    label,
    created: Number(values[`c${i}`] ?? 0),
    completed: Number(values[`d${i}`] ?? 0),
  }));
}

/**
 * A cycle's burn-up: its tasks today (the current scope) and how many of
 * them were completed by the end of each day from its start to today (or
 * its end). Scope changes over time are not replayed.
 */
export async function loadCycleBurn(input: {
  scope: AiScope;
  cycle: {
    id: string;
    name: string;
    projectId: string;
    startDate: string | null;
    endDate: string | null;
  };
  now: Date;
  timeZone: string;
}): Promise<CycleBurn | null> {
  const { scope, cycle, timeZone } = input;
  if (!cycle.startDate || !scope.projectIds.has(cycle.projectId)) return null;
  if (!scope.can.readTasks) return null;
  const today = todayInTimezone(timeZone, input.now);
  const last = cycle.endDate && cycle.endDate < today ? cycle.endDate : today;
  if (last < cycle.startDate) return null;
  const days: string[] = [];
  for (let day = cycle.startDate; day <= last; day = addDays(day, 1)) {
    days.push(day);
  }
  const shown = days.slice(-MAX_BURN_DAYS);
  const columns: Record<string, SQL<number>> = {
    total: sql<number>`count(*)::int`.mapWith(Number),
  };
  shown.forEach((day, i) => {
    columns[`d${i}`] =
      sql<number>`(count(*) filter (where ${completedSql} and ${lt(
        taskTable.completedAt,
        startOfLocalDayUtc(addDays(day, 1), timeZone),
      )}))::int`.mapWith(Number);
  });
  const [row] = await db
    .select(columns)
    .from(cycleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(cycleTaskTable.cycleId, cycle.id),
        eq(taskTable.projectId, cycle.projectId),
        eq(projectTable.workspaceId, scope.workspaceId),
        visibleTaskCondition,
      ),
    );
  const values = (row ?? {}) as Record<string, unknown>;
  const total = Number(values.total ?? 0);
  return {
    name: cycle.name,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    total,
    days: shown.map((label, i) => {
      const completed = Number(values[`d${i}`] ?? 0);
      return { label, completed, remaining: Math.max(0, total - completed) };
    }),
  };
}

/** The trend as the plain-text block the model reads. */
export function formatTrend(input: {
  unit: TrendUnit;
  scopeLabel: string;
  timeZone: string;
  buckets: readonly TrendBucket[];
  burn?: CycleBurn | null;
}): string {
  const lines: string[] = [];
  if (input.buckets.length > 0) {
    const created = input.buckets.reduce((sum, b) => sum + b.created, 0);
    const completed = input.buckets.reduce((sum, b) => sum + b.completed, 0);
    lines.push(
      input.unit === "week"
        ? `Tasks created and completed per week, computed by Margaya for ${input.scopeLabel} (${input.timeZone}; weeks start on Monday and are labelled by their first day; the last week is still in progress):`
        : `Tasks created and completed per day, computed by Margaya for ${input.scopeLabel} (${input.timeZone}; the last day is today):`,
      ...input.buckets.map(
        (bucket) =>
          `- ${bucket.label}: created ${bucket.created}, completed ${bucket.completed}`,
      ),
      `Totals over these ${input.buckets.length} ${input.unit === "week" ? "weeks" : "days"}: created ${created}, completed ${completed}.`,
    );
  }
  const burn = input.burn;
  if (burn && burn.days.length > 0) {
    lines.push(
      `Burn-up of cycle "${burn.name}" (${burn.startDate} to ${burn.endDate ?? "no end date"}), over its current ${burn.total} task(s): completed by the end of each day, and remaining (burndown):`,
      ...burn.days.map(
        (day) =>
          `- ${day.label}: completed ${day.completed}, remaining ${day.remaining}`,
      ),
    );
  }
  return lines.join("\n");
}

/** The trend facts as an Ask context item (never cited). */
export function trendItem(
  scope: AiScope,
  projectIds: readonly string[],
  text: string,
): AskItem {
  const single = projectIds.length === 1 ? (projectIds[0] ?? null) : null;
  return {
    kind: "project",
    id: single ? `trend:${single}` : "trend:workspace",
    projectId: single,
    title: "Trend",
    url: "",
    source: "facts:trend",
    author: null,
    text,
    dataTier: projectIds.some((id) => scope.restrictedProjectIds.has(id))
      ? "restricted"
      : "private",
    ref: null,
    updatedAt: null,
  };
}
