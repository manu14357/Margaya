import type { CycleStatus } from "./types";

// Cycle dates are inclusive calendar days; the generic date-only helpers
// live in utils/calendar-date.ts.

/** The longest allowed range: end − start in days (366 inclusive days). */
export const MAX_CYCLE_SPAN_DAYS = 365;

type DatedRange = { startDate: string; endDate: string };

/** Inclusive ranges overlap when each starts on or before the other's end. */
export function rangesOverlap(a: DatedRange, b: DatedRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Draft without dates, completed once the end date has passed, upcoming
 * before the start date, current otherwise (start ≤ today ≤ end).
 */
export function deriveCycleStatus(
  cycle: { startDate: string | null; endDate: string | null },
  today: string,
): CycleStatus {
  if (!cycle.startDate || !cycle.endDate) return "draft";
  if (cycle.endDate < today) return "completed";
  if (cycle.startDate > today) return "upcoming";
  return "current";
}
