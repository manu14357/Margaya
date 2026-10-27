import type { AnalyticsCycleRow } from "@/types/analytics";

// The cycles table's "Running now" filter: only cycles whose status is
// current, across every project in scope. Remembered per scope in
// localStorage; anything unreadable falls back to all cycles.

export const CYCLE_FILTERS = ["all", "running"] as const;
export type CycleFilter = (typeof CYCLE_FILTERS)[number];

export const CYCLE_FILTER_STORAGE_PREFIX = "margaya:analytics:cycle-filter:";

export function isCycleFilter(value: unknown): value is CycleFilter {
  return CYCLE_FILTERS.includes(value as CycleFilter);
}

export function filterCycleRows<Row extends Pick<AnalyticsCycleRow, "status">>(
  rows: readonly Row[],
  filter: CycleFilter,
): Row[] {
  return filter === "running"
    ? rows.filter((row) => row.status === "current")
    : [...rows];
}

export function loadCycleFilter(scopeKey: string): CycleFilter {
  try {
    const raw = window.localStorage.getItem(
      `${CYCLE_FILTER_STORAGE_PREFIX}${scopeKey}`,
    );
    return isCycleFilter(raw) ? raw : "all";
  } catch {
    return "all";
  }
}

export function saveCycleFilter(scopeKey: string, filter: CycleFilter) {
  try {
    window.localStorage.setItem(
      `${CYCLE_FILTER_STORAGE_PREFIX}${scopeKey}`,
      filter,
    );
  } catch {
    // Storage may be unavailable; the choice lasts while the page is open.
  }
}
