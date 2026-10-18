import { daySpan, shiftDate } from "../utils/calendar-date";
import { mulberry32 } from "./random";
import { percentileSorted } from "./stats";

// Delivery forecast (A2): replay the team's real daily throughput many times
// to see how many days the remaining tasks take. Day 1 is today, so a run
// that finishes on day d lands on today + (d - 1).

export const DEFAULT_ITERATIONS = 10_000;
export const MAX_FORECAST_DAYS = 730;

export type SimulationInput = {
  remaining: number;
  /** Tasks completed on each day of the history window, zeros included. */
  dailySamples: readonly number[];
  seed: number;
  iterations?: number;
  maxDays?: number;
};

/**
 * Days each simulated run needed to finish `remaining` tasks, ascending.
 * A run still unfinished after `maxDays` reads as maxDays + 1.
 */
export function simulateCompletion({
  remaining,
  dailySamples,
  seed,
  iterations = DEFAULT_ITERATIONS,
  maxDays = MAX_FORECAST_DAYS,
}: SimulationInput): Int32Array {
  const durations = new Int32Array(iterations);
  const samples = dailySamples.length;
  if (remaining <= 0) return durations;
  const random = mulberry32(seed);
  for (let run = 0; run < iterations; run++) {
    let left = remaining;
    let day = 0;
    while (left > 0 && day <= maxDays) {
      day++;
      left -=
        samples > 0 ? (dailySamples[Math.floor(random() * samples)] ?? 0) : 0;
    }
    durations[run] = Math.min(day, maxDays + 1);
  }
  return durations.sort();
}

export type ForecastPoint = { days: number; date: string };

export type ForecastSummary = {
  p50: ForecastPoint | null;
  p85: ForecastPoint | null;
  p95: ForecastPoint | null;
  /** Share of runs done by the end date (2 decimals); null without one. */
  probabilityByEnd: number | null;
  /** True when some percentile is past the simulation horizon. */
  beyondHorizon: boolean;
};

function point(
  sorted: Int32Array,
  p: number,
  today: string,
  maxDays: number,
): ForecastPoint | null {
  const days = percentileSorted(sorted, p);
  if (days === null || days > maxDays) return null;
  return { days, date: shiftDate(today, Math.max(0, days - 1)) };
}

/** Percentile dates and the chance of finishing by `endDate`. */
export function summarizeForecast({
  durations,
  today,
  endDate,
  maxDays = MAX_FORECAST_DAYS,
}: {
  durations: Int32Array;
  today: string;
  endDate: string | null;
  maxDays?: number;
}): ForecastSummary {
  const p50 = point(durations, 50, today, maxDays);
  const p85 = point(durations, 85, today, maxDays);
  const p95 = point(durations, 95, today, maxDays);
  let probabilityByEnd: number | null = null;
  if (endDate !== null) {
    const available = daySpan(today, endDate) + 1;
    if (available <= 0 || durations.length === 0) {
      probabilityByEnd = 0;
    } else {
      let done = 0;
      for (const days of durations) if (days <= available) done++;
      probabilityByEnd = Math.round((done / durations.length) * 100) / 100;
    }
  }
  return {
    p50,
    p85,
    p95,
    probabilityByEnd,
    beyondHorizon: p50 === null || p85 === null || p95 === null,
  };
}

// --- History sufficiency ----------------------------------------------------

export const HISTORY_DAYS = 56;
export const MIN_SPAN_DAYS = 14;
export const MIN_COMPLETED = 5;
export const MIN_ACTIVE_DAYS = 3;

export type HistoryShortfall =
  | "short_span"
  | "few_completions"
  | "few_active_days";

export type HistorySummary = {
  days: number;
  completed: number;
  activeDays: number;
  minPerDay: number;
  maxPerDay: number;
  /** Mean completions per 7 days, one decimal. */
  perWeek: number;
};

export function summarizeHistory(samples: readonly number[]): HistorySummary {
  const completed = samples.reduce((sum, value) => sum + value, 0);
  return {
    days: samples.length,
    completed,
    activeDays: samples.filter((value) => value > 0).length,
    minPerDay: samples.length > 0 ? Math.min(...samples) : 0,
    maxPerDay: samples.length > 0 ? Math.max(...samples) : 0,
    perWeek:
      samples.length > 0
        ? Math.round((completed / samples.length) * 7 * 10) / 10
        : 0,
  };
}

/** Why the history is too thin to forecast from, or null when it is enough. */
export function historyShortfall(
  history: HistorySummary,
): HistoryShortfall | null {
  if (history.days < MIN_SPAN_DAYS) return "short_span";
  if (history.completed < MIN_COMPLETED) return "few_completions";
  if (history.activeDays < MIN_ACTIVE_DAYS) return "few_active_days";
  return null;
}
