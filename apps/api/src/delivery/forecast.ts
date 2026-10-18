import { and, asc, eq, isNotNull } from "drizzle-orm";
import { analyticsRead } from "../analytics/scope";
import { taskTable } from "../database/schema";
import type { Reader } from "../task/progress-queries";
import { shiftDate } from "../utils/calendar-date";
import { localDateString, todayInTimezone } from "../utils/zoned-date";
import { dailyThroughput } from "./flow-history";
import {
  DEFAULT_ITERATIONS,
  HISTORY_DAYS,
  type HistoryShortfall,
  historyShortfall,
  MAX_FORECAST_DAYS,
  simulateCompletion,
  summarizeForecast,
  summarizeHistory,
} from "./monte-carlo";
import { fnv1a32 } from "./random";
import {
  type DeliveryScope,
  openScopeTaskIds,
  resolveScope,
  type ScopeType,
} from "./scope";

// Delivery forecast (A2): Monte Carlo over the project team's daily
// throughput. Reads counts and dates only, in one bounded read.

const REMAINING_LIMIT = 50_000;

/** The first local day with history: the project's start or first completion. */
async function historyStart(
  reader: Reader,
  scope: DeliveryScope,
  windowStart: string,
): Promise<string> {
  const [first] = await reader
    .select({ completedAt: taskTable.completedAt })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, scope.projectId),
        isNotNull(taskTable.completedAt),
      ),
    )
    .orderBy(asc(taskTable.completedAt))
    .limit(1);
  const created = localDateString(scope.projectCreatedAt, scope.timeZone);
  const firstDone = first?.completedAt
    ? localDateString(first.completedAt, scope.timeZone)
    : created;
  const begin = firstDone < created ? firstDone : created;
  return begin > windowStart ? begin : windowStart;
}

export async function computeForecast(
  reader: Reader,
  scope: DeliveryScope,
  now: Date = new Date(),
) {
  const today = todayInTimezone(scope.timeZone, now);
  const remaining = (await openScopeTaskIds(reader, scope, REMAINING_LIMIT))
    .length;
  const to = shiftDate(today, -1);
  const from = await historyStart(
    reader,
    scope,
    shiftDate(today, -HISTORY_DAYS),
  );
  const samples =
    from <= to
      ? await dailyThroughput(reader, scope.projectId, from, to, scope.timeZone)
      : [];
  const history = summarizeHistory(samples);
  const seed = fnv1a32(`${scope.type}:${scope.id}:${today}:${remaining}`);
  const base = {
    scope: {
      type: scope.type,
      id: scope.id,
      projectId: scope.projectId,
      endDate: scope.endDate,
    },
    today,
    remaining,
    history: {
      from: samples.length > 0 ? from : null,
      to: samples.length > 0 ? to : null,
      ...history,
    },
    method: {
      name: "monte_carlo_daily_throughput" as const,
      iterations: DEFAULT_ITERATIONS,
      seed,
      maxDays: MAX_FORECAST_DAYS,
    },
  };
  const empty = {
    p50: null,
    p85: null,
    p95: null,
    probabilityByEnd: null,
    beyondHorizon: false,
  };
  if (remaining === 0) {
    return {
      ...base,
      status: "complete" as const,
      reason: null,
      ...empty,
      probabilityByEnd: scope.endDate === null ? null : 1,
    };
  }
  const shortfall: HistoryShortfall | null = historyShortfall(history);
  if (shortfall) {
    return {
      ...base,
      status: "insufficient_history" as const,
      reason: shortfall,
      ...empty,
    };
  }
  const durations = simulateCompletion({
    remaining,
    dailySamples: samples,
    seed,
  });
  return {
    ...base,
    status: "ok" as const,
    reason: null,
    ...summarizeForecast({ durations, today, endDate: scope.endDate }),
  };
}

export type DeliveryForecast = Awaited<ReturnType<typeof computeForecast>>;

export function getForecast(type: ScopeType, id: string) {
  return analyticsRead(async (tx) =>
    computeForecast(tx, await resolveScope(tx, type, id)),
  );
}
