import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarChart from "@/components/charts/bar-chart";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import { useAnalyticsReports } from "@/hooks/queries/analytics-report/use-analytics-reports";
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
import {
  builderStateOfReport,
  isSameReportConfig,
  type ReportNote,
  type ReportTarget,
  type ReportTaskSet,
  reportConfigOf,
  reportNotes,
} from "@/lib/analytics/report-config";
import { sortBucketsByValue } from "@/lib/analytics/sort";
import { chartTableModel, TOTAL_ROW_ID } from "@/lib/analytics/table-model";
import { highestBar } from "@/lib/charts/bar-layout";
import type {
  AnalyticsChartRequest,
  AnalyticsChartResult,
  AnalyticsDimension,
  AnalyticsTaskSet,
} from "@/types/analytics";
import type { AnalyticsReport } from "@/types/analytics-report";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection from "./analytics-section";
import BuilderControls from "./builder-controls";
import CategoryLabel from "./category-label";
import ExportCsvButton from "./export-csv-button";
import ReportActions, { ReportStatus } from "./report-actions";
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
  /**
   * Saved reports: the task set a save stores (scope, toolbar filters,
   * archived) and how the page applies an opened report's task set.
   */
  reports?: {
    taskSet: ReportTaskSet;
    onOpen: (report: AnalyticsReport) => ReportTarget;
  };
};

/** The chart builder (B8 §1.5): pick an x-axis, metric and segment. */
export default function CustomChartCard({
  base,
  availability,
  pointsPossible,
  reports,
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

  // The saved report on screen: opened from the list or just saved.
  const [opened, setOpened] = useState<{
    id: string;
    notes: ReportNote[];
  } | null>(null);
  const reportsQuery = useAnalyticsReports(base.workspaceId, {
    enabled: Boolean(reports),
  });
  const openedReport =
    (opened && reportsQuery.data?.find((report) => report.id === opened.id)) ||
    null;
  const currentConfig = reports ? reportConfigOf(reports.taskSet, state) : null;
  const isDirty = Boolean(
    openedReport &&
      currentConfig &&
      !isSameReportConfig(openedReport.config, currentConfig),
  );
  const openReport = (report: AnalyticsReport) => {
    if (!reports) return;
    const target = reports.onOpen(report);
    const { state: next, reset } = builderStateOfReport(report.config, {
      dimensions: availableDimensions(target.availability),
      pointsAvailable: target.availability.features.estimates,
    });
    // The builder of the scope the report opens in, which may be another
    // scope than this one until the page switches to it.
    setStored({ scopeKey: target.scopeKey, raw: next });
    saveBuilderState(target.scopeKey, next);
    setOpened({
      id: report.id,
      notes: reportNotes(target.plan, {
        droppedCount: report.droppedProjectCount,
        builderReset: reset,
      }),
    });
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
        <>
          {reports && currentConfig && (
            <ReportActions
              workspaceId={base.workspaceId}
              reports={reportsQuery.data}
              isLoading={reportsQuery.isLoading}
              error={reportsQuery.error}
              onRetry={() => void reportsQuery.refetch()}
              opened={openedReport}
              isDirty={isDirty}
              currentConfig={currentConfig}
              onOpen={openReport}
              onSaved={(saved) => setOpened({ id: saved.id, notes: [] })}
            />
          )}
          <ExportCsvButton
            model={table.model}
            section={`tasks-by-${state.xAxis}`}
          />
        </>
      }
      controls={
        <>
          <BuilderControls
            state={state}
            onChange={update}
            dimensions={dimensions}
            segments={segmentOptions(state.xAxis, availability)}
            pointsAvailable={pointsAvailable}
          />
          {openedReport && (
            <ReportStatus
              report={openedReport}
              isDirty={isDirty}
              notes={opened?.notes ?? []}
              onClose={() => setOpened(null)}
            />
          )}
        </>
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
