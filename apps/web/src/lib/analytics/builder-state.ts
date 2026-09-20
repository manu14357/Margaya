import type { AnalyticsDimension, AnalyticsMetric } from "@/types/analytics";
import {
  type CategoryDimension,
  DIMENSIONS,
  isAnalyticsDimension,
  isDateDimension,
} from "./dimensions";

// The custom chart builder's configuration (B8 §1.5), stored per scope in
// localStorage. Stored values are parsed defensively: anything unknown or no
// longer available (a dimension whose feature was turned off, points after
// estimates were disabled) falls back to its default.

export const BUILDER_STORAGE_PREFIX = "margaya:analytics:builder:";

export type BuilderState = {
  xAxis: AnalyticsDimension;
  metric: AnalyticsMetric;
  segment: CategoryDimension | null;
  dateBucket: "week" | "month";
  includeNone: boolean;
  sortByValue: boolean;
  showSubTasks: boolean;
};

export type BuilderAvailability = {
  /** The x-axis choices of the scope. */
  dimensions: readonly AnalyticsDimension[];
  pointsAvailable: boolean;
};

export const DEFAULT_X_AXIS: AnalyticsDimension = "priority";

export function defaultSortByValue(dimension: AnalyticsDimension): boolean {
  return DIMENSIONS[dimension].defaultSort === "value";
}

export function defaultBuilderState(
  xAxis: AnalyticsDimension = DEFAULT_X_AXIS,
): BuilderState {
  return {
    xAxis,
    metric: "taskCount",
    segment: null,
    dateBucket: "month",
    includeNone: true,
    sortByValue: defaultSortByValue(xAxis),
    showSubTasks: true,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeBuilderState(
  raw: unknown,
  availability: BuilderAvailability,
): BuilderState {
  const candidate =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const offered = (value: unknown): value is AnalyticsDimension =>
    isAnalyticsDimension(value) && availability.dimensions.includes(value);

  const fallbackX = availability.dimensions.includes(DEFAULT_X_AXIS)
    ? DEFAULT_X_AXIS
    : (availability.dimensions[0] ?? DEFAULT_X_AXIS);
  const xAxis = offered(candidate.xAxis) ? candidate.xAxis : fallbackX;
  const defaults = defaultBuilderState(xAxis);

  const segment =
    offered(candidate.segment) &&
    candidate.segment !== xAxis &&
    !isDateDimension(candidate.segment)
      ? (candidate.segment as CategoryDimension)
      : null;
  const metric: AnalyticsMetric =
    candidate.metric === "estimatePoints" && availability.pointsAvailable
      ? "estimatePoints"
      : "taskCount";
  const dateBucket =
    candidate.dateBucket === "week" || candidate.dateBucket === "month"
      ? candidate.dateBucket
      : defaults.dateBucket;
  // The stored sort belongs to the stored x-axis; a fallback x-axis starts
  // from its own default.
  const sortByValue =
    xAxis === candidate.xAxis
      ? asBoolean(candidate.sortByValue, defaults.sortByValue)
      : defaults.sortByValue;

  return {
    xAxis,
    metric,
    segment,
    dateBucket,
    includeNone: asBoolean(candidate.includeNone, defaults.includeNone),
    sortByValue,
    showSubTasks: asBoolean(candidate.showSubTasks, defaults.showSubTasks),
  };
}

/** A new x-axis: the segment can't equal it, and the sort resets. */
export function withXAxis(
  state: BuilderState,
  xAxis: AnalyticsDimension,
): BuilderState {
  return {
    ...state,
    xAxis,
    segment: state.segment === xAxis ? null : state.segment,
    sortByValue: defaultSortByValue(xAxis),
  };
}

export function builderStorageKey(scopeKey: string): string {
  return `${BUILDER_STORAGE_PREFIX}${scopeKey}`;
}

/** The stored configuration, unparsed; null when absent or unreadable. */
export function loadBuilderState(scopeKey: string): unknown {
  try {
    const raw = window.localStorage.getItem(builderStorageKey(scopeKey));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveBuilderState(scopeKey: string, state: BuilderState) {
  try {
    window.localStorage.setItem(
      builderStorageKey(scopeKey),
      JSON.stringify(state),
    );
  } catch {
    // Storage may be unavailable or full; the builder keeps working in memory.
  }
}
