import {
  buildSeriesColors,
  type ChartColor,
  NONE_CHART_COLOR,
  NONE_SERIES_KEY,
  OTHER_CHART_COLOR,
  OTHER_SERIES_KEY,
  type SeriesColorScheme,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import type {
  AnalyticsBucket,
  AnalyticsChartResult,
  AnalyticsDimension,
} from "@/types/analytics";
import { labelColors } from "./labels";

// Chart result → bar chart data and series (B8 §4.7): group, priority and
// label keys keep their identity colors, other keys a stable slot, and
// `other` and `none` their muted colors.

export type ChartSeriesModel = {
  key: string;
  label: string;
  color: ChartColor;
};

export type BarDatumModel = {
  key: string;
  value: number;
  cells?: Readonly<Record<string, number>>;
  color?: ChartColor;
};

export function colorSchemeOf(
  dimension: AnalyticsDimension | null,
): SeriesColorScheme {
  if (dimension === "group") return "group";
  if (dimension === "priority") return "priority";
  return "slots";
}

type LabelOf = (dimension: AnalyticsDimension, key: string) => string;

/** Plain bars: one series named by the metric, identity colors per bucket. */
function plainModel(
  result: AnalyticsChartResult,
  buckets: readonly AnalyticsBucket[],
  metricLabel: string,
) {
  const x = result.xAxis;
  const identity = x === "group" || x === "priority" || x === "label";
  const colors = identity
    ? buildSeriesColors(
        buckets.map((bucket) => bucket.key),
        {
          scheme: colorSchemeOf(x),
          custom: x === "label" ? labelColors(result.meta) : undefined,
        },
      )
    : null;
  const colorOf = (key: string): ChartColor => {
    if (colors) return colors.get(key) ?? SINGLE_SERIES_COLOR;
    if (key === NONE_SERIES_KEY) return NONE_CHART_COLOR;
    if (key === OTHER_SERIES_KEY) return OTHER_CHART_COLOR;
    return SINGLE_SERIES_COLOR;
  };
  return {
    series: [{ key: "value", label: metricLabel, color: SINGLE_SERIES_COLOR }],
    data: buckets.map(
      (bucket): BarDatumModel => ({
        key: bucket.key,
        value: bucket.value,
        color: colorOf(bucket.key),
      }),
    ),
  };
}

/**
 * The bars and series of a chart result, in the given bucket order. With a
 * segment the bars stack in legend order (the response's segment order).
 */
export function buildBarModel(
  result: AnalyticsChartResult,
  {
    labelOf,
    metricLabel,
    buckets = result.buckets,
  }: {
    labelOf: LabelOf;
    metricLabel: string;
    buckets?: readonly AnalyticsBucket[];
  },
): { series: ChartSeriesModel[]; data: BarDatumModel[]; stacked: boolean } {
  const segment = result.segment;
  if (!segment) {
    return { ...plainModel(result, buckets, metricLabel), stacked: false };
  }
  const keys = result.segments.map((entry) => entry.key);
  const colors = buildSeriesColors(keys, {
    scheme: colorSchemeOf(segment),
    custom: segment === "label" ? labelColors(result.meta) : undefined,
  });
  return {
    stacked: true,
    series: keys.map((key) => ({
      key,
      label: labelOf(segment, key),
      color: colors.get(key) ?? SINGLE_SERIES_COLOR,
    })),
    data: buckets.map((bucket) => ({
      key: bucket.key,
      value: bucket.value,
      cells: bucket.cells ?? {},
    })),
  };
}
