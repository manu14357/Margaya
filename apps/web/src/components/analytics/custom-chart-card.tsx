import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarChart from "@/components/charts/bar-chart";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import {
  type BuilderState,
  loadBuilderState,
  normalizeBuilderState,
  saveBuilderState,
} from "@/lib/analytics/builder-state";
import { buildBarModel } from "@/lib/analytics/chart-model";
import {
  availableDimensions,
  DIMENSIONS,
  type DimensionAvailability,
  isDateDimension,
  orientationOf,
  segmentOptions,
} from "@/lib/analytics/dimensions";
import { periodTitle } from "@/lib/analytics/labels";
import { sortBucketsByValue } from "@/lib/analytics/sort";
import { chartTableModel, TOTAL_ROW_ID } from "@/lib/analytics/table-model";
import { highestBar } from "@/lib/charts/bar-layout";
import type {
  AnalyticsChartRequest,
  AnalyticsChartResult,
  AnalyticsDimension,
  AnalyticsTaskSet,
} from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection from "./analytics-section";
import BuilderControls from "./builder-controls";
import CategoryLabel from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { useLabelOf } from "./use-label-of";

/** The notes under the chart: truncation and many-valued counting. */
export function useChartNotes(
  result: AnalyticsChartResult | undefined,
): string[] {
  const { t } = useTranslation();
  if (!result) return [];
  const notes: string[] = [];
  const pluralOf = (dimension: AnalyticsDimension) => {
    const key = DIMENSIONS[dimension].pluralKey;
    return key ? t(key) : t("analytics:dimensionsPlural.period");
  };
  if (result.truncated.x) {
    notes.push(
      t("analytics:builder.truncatedX", {
        shown: result.buckets.length,
        total: result.buckets.length + result.truncated.hiddenXCount,
        dimension: pluralOf(result.xAxis),
      }),
    );
  }
  if (result.truncated.segment) {
    notes.push(
      t("analytics:builder.truncatedSegments", {
        count: result.truncated.hiddenSegmentCount,
      }),
    );
  }
  const many = result.multiValued.x
    ? result.xAxis
    : result.multiValued.segment
      ? result.segment
      : null;
  if (many) {
    notes.push(
      t("analytics:builder.multiValued", { dimension: pluralOf(many) }),
    );
  }
  return notes;
}

type CustomChartCardProps = {
  base: AnalyticsTaskSet;
  availability: DimensionAvailability;
  /** A scope project has estimates on, so points may exist. */
  pointsPossible: boolean;
};

/** The chart builder (B8 §1.5): pick an x-axis, metric and segment. */
export default function CustomChartCard({
  base,
  availability,
  pointsPossible,
}: CustomChartCardProps) {
  const { t } = useTranslation();
  const { scopeKey } = useAnalyticsScope();
  const [stored, setStored] = useState(() => ({
    scopeKey,
    raw: loadBuilderState(scopeKey),
  }));
  const raw =
    stored.scopeKey === scopeKey ? stored.raw : loadBuilderState(scopeKey);
  // What the last result said about points; unknown until one arrives.
  const [pointsKnown, setPointsKnown] = useState<boolean | null>(null);

  const dimensions = useMemo(
    () => availableDimensions(availability),
    [availability],
  );
  const pointsAvailable = pointsPossible && pointsKnown !== false;
  const state = normalizeBuilderState(raw, { dimensions, pointsAvailable });
  const update = (next: BuilderState) => {
    setStored({ scopeKey, raw: next });
    saveBuilderState(scopeKey, next);
  };

  const dateX = isDateDimension(state.xAxis);
  const request = useMemo<AnalyticsChartRequest>(
    () => ({
      ...base,
      showSubTasks: state.showSubTasks,
      xAxis: state.xAxis,
      segment: state.segment,
      metric: state.metric,
      ...(dateX ? { dateBucket: state.dateBucket } : {}),
      includeNone: state.includeNone,
    }),
    [
      base,
      state.showSubTasks,
      state.xAxis,
      state.segment,
      state.metric,
      dateX,
      state.dateBucket,
      state.includeNone,
    ],
  );
  const query = useAnalyticsChart(request);
  const result = query.data;
  useEffect(() => {
    if (result) setPointsKnown(result.pointsProjectIds.length > 0);
  }, [result]);

  const labelOf = useLabelOf(result);
  const metricLabel =
    result?.metric === "estimatePoints"
      ? t("analytics:metric.points")
      : t("analytics:metric.tasks");
  const buckets = useMemo(() => {
    if (!result) return [];
    return state.sortByValue && !isDateDimension(result.xAxis)
      ? sortBucketsByValue(result.buckets)
      : result.buckets;
  }, [result, state.sortByValue]);
  const barModel = useMemo(
    () =>
      result ? buildBarModel(result, { labelOf, metricLabel, buckets }) : null,
    [result, labelOf, metricLabel, buckets],
  );
  const tableModel = useMemo(
    () =>
      result
        ? chartTableModel(result, {
            t,
            dimensionLabel: t(DIMENSIONS[result.xAxis].labelKey),
            metricLabel,
            labelOf,
            buckets,
          })
        : null,
    [result, t, metricLabel, labelOf, buckets],
  );
  const table = useSortedTable(tableModel);
  const notes = useChartNotes(result);
  const top = highestBar(buckets);

  const renderCategory = (key: string) =>
    result ? (
      <CategoryLabel
        dimension={result.xAxis}
        bucketKey={key}
        name={labelOf(result.xAxis, key)}
        meta={result.meta}
      />
    ) : null;

  return (
    <AnalyticsSection
      title={t("analytics:builder.title")}
      subtitle={t("analytics:builder.subtitle")}
      actions={
        <ExportCsvButton
          model={table.model}
          section={`tasks-by-${state.xAxis}`}
        />
      }
      controls={
        <BuilderControls
          state={state}
          onChange={update}
          dimensions={dimensions}
          segments={segmentOptions(state.xAxis, availability)}
          pointsAvailable={pointsAvailable}
        />
      }
      isLoading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!result || result.totalCount === 0}
      emptyTitle={t("analytics:states.noTasks")}
      isRefreshing={query.isPlaceholderData}
    >
      {result && barModel && (
        <div className="grid gap-3">
          <BarChart
            data={barModel.data}
            series={barModel.series}
            stacked={barModel.stacked}
            orientation={orientationOf(result.xAxis)}
            totalLabel={t("analytics:table.total")}
            categoryLabel={(key) =>
              dateX ? labelOf(result.xAxis, key) : renderCategory(key)
            }
            tooltipTitle={(key) => {
              const bucket = result.buckets.find((entry) => entry.key === key);
              return dateX && bucket?.rangeStart
                ? periodTitle({ start: key, ...bucket }, result.dateBucket, {
                    t,
                  })
                : labelOf(result.xAxis, key);
            }}
            ariaLabel={t("analytics:a11y.barSummary", {
              metric: metricLabel,
              dimension: t(DIMENSIONS[result.xAxis].labelKey),
              count: buckets.length,
              label: top ? labelOf(result.xAxis, top.key) : "",
              value: top?.value ?? 0,
            })}
          />
          {notes.length > 0 && (
            <ul className="grid gap-0.5 text-muted-foreground text-xs">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {table.model && (
            <AnalyticsDataTable
              model={table.model}
              sort={table.sort}
              onSortChange={table.setSort}
              renderCell={(column, row) =>
                column.id === "name" && row.id !== TOTAL_ROW_ID
                  ? renderCategory(row.key)
                  : undefined
              }
            />
          )}
        </div>
      )}
    </AnalyticsSection>
  );
}
