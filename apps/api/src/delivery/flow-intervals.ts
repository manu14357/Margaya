import type { ColumnGroup } from "../column/groups";

// When was a task "in progress"? Rebuilt from its status history: every
// `status_changed` activity row holds the old and new column slugs. Slugs
// are stable across renames; a slug whose column is gone maps to no group
// and counts as not started.

export type StatusEvent = { at: Date; oldStatus: string; newStatus: string };

export type TaskFlowInput = {
  createdAt: Date;
  status: string;
  /** Status changes, oldest first. */
  events: readonly StatusEvent[];
};

export type StartedInterval = { start: Date; end: Date | null };

export type TaskFlow = {
  intervals: StartedInterval[];
  /** First time the task entered a started-group column. */
  firstStartedAt: Date | null;
  /** Start of the current stint, while the task is started now. */
  currentStartedAt: Date | null;
};

export function rebuildTaskFlow(
  task: TaskFlowInput,
  groupOf: (slug: string) => ColumnGroup | null,
): TaskFlow {
  const intervals: StartedInterval[] = [];
  const isStarted = (slug: string) => groupOf(slug) === "started";
  const first = task.events[0];
  let started = isStarted(first ? first.oldStatus : task.status);
  let since: Date = task.createdAt;
  for (const event of task.events) {
    const next = isStarted(event.newStatus);
    if (started && !next) intervals.push({ start: since, end: event.at });
    if (!started && next) since = event.at;
    started = next;
  }
  // A history that ends "started" while the task no longer is (a change made
  // without a history row) leaves the stint out rather than guess its end.
  const openNow = started && isStarted(task.status);
  if (openNow) intervals.push({ start: since, end: null });
  return {
    intervals,
    firstStartedAt: intervals[0]?.start ?? null,
    currentStartedAt: openNow ? since : null,
  };
}

const DAY_MS = 86_400_000;

/** Whole and fractional days between two instants. */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/**
 * Cycle time in days: first start to completion. Null when the task never
 * visibly entered a started column, or the history is inconsistent.
 */
export function cycleTimeDays(
  flow: TaskFlow,
  completedAt: Date,
): number | null {
  if (!flow.firstStartedAt) return null;
  const days = daysBetween(flow.firstStartedAt, completedAt);
  return days >= 0 ? days : null;
}

/** How many tasks were in progress at each instant. */
export function wipAt(
  flows: readonly TaskFlow[],
  instants: readonly Date[],
): number[] {
  return instants.map((instant) => {
    const time = instant.getTime();
    let count = 0;
    for (const flow of flows) {
      for (const interval of flow.intervals) {
        if (
          interval.start.getTime() <= time &&
          (interval.end === null || interval.end.getTime() > time)
        ) {
          count++;
          break;
        }
      }
    }
    return count;
  });
}
