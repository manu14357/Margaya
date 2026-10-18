import { shiftDate } from "../utils/calendar-date";
import { median, robustScale } from "./stats";

// Flow anomaly detection (A4): a robust control chart per metric. The last
// full week is compared with the eight weeks before it using the median and
// the scaled MAD; a weekly aggregate is what makes a deviation "sustained".
// Only the harmful direction alerts: throughput down, WIP up, cycle time up.

export const FLOW_METRICS = ["wip", "cycle_time", "throughput"] as const;
export type FlowMetric = (typeof FLOW_METRICS)[number];
export type FlowDirection = "high" | "low";

export const BASELINE_WEEKS = 8;
export const Z_THRESHOLD = 3;
export const MIN_BASELINE_WEEKS = 5;
export const MIN_BASELINE_COMPLETIONS = 10;

/** The smallest spread a metric is judged against (tasks, or days). */
const SCALE_FLOOR: Record<FlowMetric, number> = {
  throughput: 1,
  wip: 1,
  cycle_time: 1,
};

const HARMFUL: Record<FlowMetric, FlowDirection> = {
  throughput: "low",
  wip: "high",
  cycle_time: "high",
};

export type WeeklySeries = {
  /** The baseline weeks, oldest first; null for a week with no reading. */
  baseline: ReadonlyArray<number | null>;
  current: number | null;
};

export type FlowAnomaly = {
  metric: FlowMetric;
  direction: FlowDirection;
  value: number;
  median: number;
  scale: number;
  z: number;
};

/** One metric's verdict, or null when it is normal or unjudgeable. */
export function detectAnomaly(
  metric: FlowMetric,
  series: WeeklySeries,
): FlowAnomaly | null {
  if (series.current === null) return null;
  const baseline = series.baseline.filter(
    (value): value is number => value !== null,
  );
  if (baseline.length < MIN_BASELINE_WEEKS) return null;
  if (
    metric === "throughput" &&
    baseline.reduce((sum, value) => sum + value, 0) < MIN_BASELINE_COMPLETIONS
  ) {
    return null;
  }
  const center = median(baseline) as number;
  const scale = robustScale(baseline, SCALE_FLOOR[metric]);
  const z = (series.current - center) / scale;
  const direction: FlowDirection = z >= 0 ? "high" : "low";
  if (direction !== HARMFUL[metric] || Math.abs(z) < Z_THRESHOLD) return null;
  return {
    metric,
    direction,
    value: series.current,
    median: center,
    scale,
    z: Math.round(z * 100) / 100,
  };
}

/** Every harmful anomaly across the metrics, in metric order. */
export function detectFlowAnomalies(
  series: Record<FlowMetric, WeeklySeries>,
): FlowAnomaly[] {
  return FLOW_METRICS.map((metric) =>
    detectAnomaly(metric, series[metric]),
  ).filter((anomaly): anomaly is FlowAnomaly => anomaly !== null);
}

export const WEEK_DAYS = 7;

/** The Monday on or before `day`. */
export function weekStartOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDate(day, -((weekday + 6) % 7));
}

/** Split daily values into consecutive 7-day weeks (oldest first). */
export function chunkWeeks<T>(daily: readonly T[]): T[][] {
  const weeks: T[][] = [];
  for (let start = 0; start + WEEK_DAYS <= daily.length; start += WEEK_DAYS) {
    weeks.push(daily.slice(start, start + WEEK_DAYS));
  }
  return weeks;
}
