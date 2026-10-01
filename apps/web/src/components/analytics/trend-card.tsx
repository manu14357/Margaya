import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import LineChart from "@/components/charts/line-chart";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import { useAnalyticsTrend } from "@/hooks/queries/analytics/use-analytics-trend";
import { formatBucketDay, periodTitle } from "@/lib/analytics/labels";
import type { DateRange } from "@/lib/analytics/periods";
import { trendTableModel } from "@/lib/analytics/table-model";
import {
  GROUP_CHART_COLORS,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import { formatNumber } from "@/lib/format";
import type {
  AnalyticsMetric,
  AnalyticsTaskSet,
  AnalyticsTrendRequest,
} from "@/types/analytics";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, {
  type SectionView,
  ViewToggle,
} from "./analytics-section";
import ExportCsvButton from "./export-csv-button";
import PeriodControls, { usePeriodState } from "./period-controls";

export function MetricToggle({
  value,
  onChange,
}: {
  value: AnalyticsMetric;
  onChange: (metric: AnalyticsMetric) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("analytics:metric.label")}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0];
        if (next === "taskCount" || next === "estimatePoints") onChange(next);
      }}
    >
      <Toggle value="taskCount" className="px-2 text-xs">
        {t("analytics:metric.tasks")}
      </Toggle>
      <Toggle value="estimatePoints" className="px-2 text-xs">
        {t("analytics:metric.pointsShort")}
      </Toggle>
    </ToggleGroup>
  );
}

type TrendCardProps = {
  base: AnalyticsTaskSet;
  /** A dated cycle context starts on the cycle's own dates. */
  initialRange?: DateRange | null;
  /** A scope project has estimates on, so points may exist. */
  pointsPossible: boolean;
};

/** Created vs completed per week or month (B8 §1.4 step 3). */
export default function TrendCard({
  base,
  initialRange,
  pointsPossible,
}: TrendCardProps) {
  const { t } = useTranslation();
  const period = usePeriodState(initialRange);
  const [metric, setMetric] = useState<AnalyticsMetric>("taskCount");
  const [view, setView] = useState<SectionView>("chart");

  const request = useMemo<AnalyticsTrendRequest>(
    () => ({
      ...base,
      from: period.range.from,
      to: period.range.to,
      bucket: period.bucket,
      metric,
    }),
    [base, period.range, period.bucket, metric],
  );
  const query = useAnalyticsTrend(request);
  const result = query.data;
  const showPoints =
    pointsPossible && (result?.pointsProjectIds.length ?? 1) > 0;

  useEffect(() => {
    if (!showPoints && metric === "estimatePoints") setMetric("taskCount");
  }, [showPoints, metric]);

  const labels = useMemo(
    () => ({
      created: t("analytics:trend.created"),
      completed: t("analytics:trend.completed"),
    }),
    [t],
  );
  const tableModel = useMemo(
    () => (result ? trendTableModel(result, labels, t) : null),
    [result, labels, t],
  );
  const table = useSortedTable(tableModel);
  const isEmpty =
    !result || (result.totals.created === 0 && result.totals.completed === 0);

  return (
    <AnalyticsSection
      title={t("analytics:trend.title")}
      help={t("analytics:trend.help")}
      subtitle={
        result
          ? t("analytics:trend.summary", {
              created: formatNumber(result.totals.created),
              completed: formatNumber(result.totals.completed),
              net: formatNumber(result.totals.net),
            })
          : undefined
      }
      actions={
        <>
          <ViewToggle value={view} onChange={setView} />
          {view === "table" && (
            <ExportCsvButton model={table.model} section="trend" />
          )}
        </>
      }
      controls={
        <>
          <PeriodControls state={period} />
          {showPoints && <MetricToggle value={metric} onChange={setMetric} />}
        </>
      }
      isLoading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={isEmpty}
      emptyTitle={t("analytics:states.noPeriodData")}
      isRefreshing={query.isPlaceholderData}
    >
      {result &&
        (view === "table" && table.model ? (
          <AnalyticsDataTable
            model={table.model}
            sort={table.sort}
            onSortChange={table.setSort}
          />
        ) : (
          <LineChart
            labels={result.series.map((point) =>
              formatBucketDay(point.start, result.bucket, {
                today: result.today,
              }),
            )}
            series={[
              {
                key: "created",
                label: labels.created,
                color: SINGLE_SERIES_COLOR,
                values: result.series.map((point) => point.created),
              },
              {
                key: "completed",
                label: labels.completed,
                color: GROUP_CHART_COLORS.completed,
                values: result.series.map((point) => point.completed),
              },
            ]}
            tooltipTitle={(index) => {
              const point = result.series[index];
              return point ? periodTitle(point, result.bucket, { t }) : "";
            }}
            ariaLabel={t("analytics:a11y.lineSummary", {
              series: `${labels.created}, ${labels.completed}`,
              count: result.series.length,
            })}
          />
        ))}
    </AnalyticsSection>
  );
}
