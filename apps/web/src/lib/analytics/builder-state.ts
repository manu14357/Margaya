import type { AnalyticsDimension, AnalyticsMetric } from "@/types/analytics";
import {
  availableDimensions,
  type CategoryDimension,
  type DimensionAvailability,
  dimensionInfo,
  fieldIdOfDimension,
  fieldsOfType,
  fieldsPending,
  isAnalyticsDimension,
  isCustomFieldDimension,
  isDateDimension,
} from "./dimensions";

// The custom chart builder's configuration (B8 §1.5), stored per scope in
// localStorage. Stored values are parsed defensively: anything unknown or no
// longer available (a dimension whose feature was turned off, points after
// estimates were disabled, a deleted custom field) falls back to its default.

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
  /** Number custom fields of the scope, which the metric can sum. */
  numberFieldIds?: readonly string[];
  /**
   * The scope's custom fields are still loading: a stored custom field
   * stays until they arrive and say whether it still exists.
   */
  fieldsPending?: boolean;
};

/** What the builder may offer in a scope. */
export function builderAvailabilityOf(
  availability: DimensionAvailability,
  pointsAvailable: boolean,
): BuilderAvailability {
  return {
    dimensions: availableDimensions(availability),
    pointsAvailable,
    numberFieldIds: fieldsOfType(availability, "number").map(
      (field) => field.id,
    ),
    fieldsPending: fieldsPending(availability),
  };
}

/** The state charts a custom field (as the x-axis, segment or metric). */
export function usesCustomField(state: BuilderState): boolean {
  return [state.xAxis, state.segment, state.metric].some(
    isCustomFieldDimension,
  );
}

export const DEFAULT_X_AXIS: AnalyticsDimension = "priority";

export function defaultSortByValue(dimension: AnalyticsDimension): boolean {
  return dimensionInfo(dimension).defaultSort === "value";
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
  const pending = availability.fieldsPending === true;
  const offered = (value: unknown): value is AnalyticsDimension =>
    isAnalyticsDimension(value) &&
    (availability.dimensions.includes(value) ||
      (pending && isCustomFieldDimension(value)));

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
  const sums = (value: unknown) =>
    isCustomFieldDimension(value) &&
    (pending ||
      (availability.numberFieldIds ?? []).includes(fieldIdOfDimension(value)));
  const metric: AnalyticsMetric =
    candidate.metric === "estimatePoints" && availability.pointsAvailable
      ? "estimatePoints"
      : sums(candidate.metric)
        ? (candidate.metric as AnalyticsMetric)
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
