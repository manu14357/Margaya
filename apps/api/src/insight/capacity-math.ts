import { percentile } from "../delivery/stats";

// Capacity check for cycles (report 03, #10): pure maths. Capacity is what
// the team actually finished in comparable time before, never a target; the
// load is what the cycle holds now. No model is involved.

/** Past cycles read for the history. */
export const HISTORY_CYCLES = 6;
/** Fewer ended cycles than this fall back to daily throughput. */
export const MIN_HISTORY_CYCLES = 2;
/** Daily throughput history for the fallback, in days. */
export const THROUGHPUT_WINDOW_DAYS = 56;
/** The most deferral suggestions returned. */
export const MAX_DEFERRALS = 10;

export type CapacityRange = {
  /** 25th percentile: a slow cycle. */
  low: number;
  /** Median: a usual cycle. */
  typical: number;
  /** 75th percentile: a good cycle. */
  high: number;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

function rangeOf(values: readonly number[]): CapacityRange | null {
  if (values.length === 0) return null;
  return {
    low: round1(percentile(values, 25) ?? 0),
    typical: round1(percentile(values, 50) ?? 0),
    high: round1(percentile(values, 75) ?? 0),
  };
}

export type PastCycle = {
  /** Inclusive length in days. */
  days: number;
  completedTasks: number;
  /** Sum of completed estimates; null when nothing was estimated. */
  completedPoints: number | null;
};

/**
 * Capacity from ended cycles: each one's completions per day, scaled to the
 * planned length. Null below MIN_HISTORY_CYCLES cycles.
 */
export function capacityFromCycles(
  past: readonly PastCycle[],
  plannedDays: number,
): { tasks: CapacityRange; points: CapacityRange | null } | null {
  const usable = past.filter((cycle) => cycle.days > 0);
  if (usable.length < MIN_HISTORY_CYCLES || plannedDays <= 0) return null;
  const tasks = rangeOf(
    usable.map((cycle) => (cycle.completedTasks / cycle.days) * plannedDays),
  );
  const withPoints = usable.filter(
    (cycle) => cycle.completedPoints !== null && cycle.completedPoints > 0,
  );
  const points =
    withPoints.length >= MIN_HISTORY_CYCLES
      ? rangeOf(
          withPoints.map(
            (cycle) =>
              ((cycle.completedPoints as number) / cycle.days) * plannedDays,
          ),
        )
      : null;
  return tasks ? { tasks, points } : null;
}

/**
 * Capacity from daily throughput (delivery/flow-history.ts): the tasks
 * finished in every window of `plannedDays` consecutive days of the
 * history. Null when the history is shorter than one window or empty.
 */
export function capacityFromThroughput(
  daily: readonly number[],
  plannedDays: number,
): CapacityRange | null {
  if (plannedDays <= 0 || daily.length < plannedDays) return null;
  if (daily.every((count) => count === 0)) return null;
  const sums: number[] = [];
  let window = 0;
  for (let index = 0; index < daily.length; index++) {
    window += daily[index] ?? 0;
    if (index >= plannedDays) window -= daily[index - plannedDays] ?? 0;
    if (index >= plannedDays - 1) sums.push(window);
  }
  return rangeOf(sums);
}

export type LoadStatus = "ok" | "over" | "unknown";

/** Load against a usual cycle: percent of it, and over when above it. */
export function loadAgainst(
  load: number,
  capacity: CapacityRange | null,
): { percent: number | null; status: LoadStatus } {
  if (!capacity) return { percent: null, status: "unknown" };
  if (capacity.typical <= 0) {
    return { percent: null, status: load > 0 ? "over" : "ok" };
  }
  const percent = Math.round((load / capacity.typical) * 100);
  return { percent, status: load > capacity.typical ? "over" : "ok" };
}

const PRIORITY_RANK: Record<string, number> = {
  "no-priority": 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export type DeferCandidate = {
  id: string;
  priority: string;
  /** Open tasks this one blocks. */
  dependants: number;
  /** What the task adds to the load (1 for task counts). */
  size: number;
};

/**
 * Tasks to move out until the load fits a usual cycle: lowest priority
 * first, then the fewest dependants, then the biggest (fewest moves).
 * Callers pass only tasks that have not started.
 */
export function suggestDeferrals(
  candidates: readonly DeferCandidate[],
  excess: number,
  limit = MAX_DEFERRALS,
): string[] {
  if (excess <= 0) return [];
  const ordered = [...candidates]
    .filter((task) => task.size > 0)
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0) ||
        a.dependants - b.dependants ||
        b.size - a.size ||
        a.id.localeCompare(b.id),
    );
  const picked: string[] = [];
  let removed = 0;
  for (const task of ordered) {
    if (removed >= excess || picked.length >= limit) break;
    picked.push(task.id);
    removed += task.size;
  }
  return picked;
}
