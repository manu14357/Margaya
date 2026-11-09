import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarChart from "@/components/charts/bar-chart";
import { entityTableModel } from "@/lib/analytics/table-model";
import { highestBar } from "@/lib/charts/bar-layout";
import { GROUP_CHART_COLORS } from "@/lib/charts/series-colors";
import { formatNumber } from "@/lib/format";
import type { AnalyticsCountMetric, AnalyticsCycles } from "@/types/analytics";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, {
  SectionEmpty,
  type SectionView,
  ViewToggle,
} from "./analytics-section";
import ExportCsvButton from "./export-csv-button";
import { MetricToggle } from "./trend-card";

type VelocityCardProps = {
  data: AnalyticsCycles | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
};

/** Completed vs committed per completed cycle, oldest first (one project). */
export default function VelocityCard({
  data,
  isLoading,
  error,
  onRetry,
}: VelocityCardProps) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<AnalyticsCountMetric>("taskCount");
  const [view, setView] = useState<SectionView>("chart");
  const velocity = data?.velocity ?? null;
  const pointsAvailable =
    velocity?.some((point) => point.committedPoints !== null) ?? false;
  const usePoints = metric === "estimatePoints" && pointsAvailable;

  const points = useMemo(
    () =>
      (velocity ?? []).map((point) => {
        const committed = usePoints
          ? (point.committedPoints ?? 0)
          : point.committed;
        const completed = usePoints
          ? (point.completedPoints ?? 0)
          : point.completed;
        return {
          id: point.cycleId,
          name: point.name,
          startDate: point.startDate,
          endDate: point.endDate,
          committed,
          completed,
        };
      }),
    [velocity, usePoints],
  );
  const average = usePoints
    ? (data?.averageCompletedPoints ?? null)
    : (data?.averageCompleted ?? null);

  const completedLabel = t("analytics:cycles.velocity.completed");
  const notCompletedLabel = t("analytics:cycles.velocity.notCompleted");
  const committedLabel = t("analytics:cycles.table.committed");
  const tableModel = useMemo(
    () =>
      entityTableModel(points, [
        {
          id: "name",
          label: t("analytics:cycles.table.cycle"),
          kind: "text",
          value: (point) => point.name,
        },
        {
          id: "startDate",
          label: t("analytics:dimensions.startDate"),
          kind: "date",
          value: (point) => point.startDate,
        },
        {
          id: "endDate",
          label: t("analytics:cycles.table.endDate"),
          kind: "date",
          value: (point) => point.endDate,
        },
        {
          id: "committed",
          label: committedLabel,
          kind: "number",
          value: (point) => point.committed,
        },
        {
          id: "completed",
          label: completedLabel,
          kind: "number",
          value: (point) => point.completed,
        },
      ]),
    [points, t, committedLabel, completedLabel],
  );
  const table = useSortedTable(tableModel);
  const top = highestBar(
    points.map((point) => ({ key: point.id, value: point.completed })),
  );
  const nameOf = (key: string) =>
    points.find((point) => point.id === key)?.name ?? key;
  const several = (data?.enabledProjectIds.length ?? 0) > 1;

  return (
    <AnalyticsSection
      title={t("analytics:cycles.velocity.title")}
      subtitle={t("analytics:cycles.velocity.subtitle")}
      actions={
        velocity && velocity.length > 0 ? (
          <>
            {pointsAvailable && (
              <MetricToggle value={metric} onChange={setMetric} />
            )}
            <ViewToggle value={view} onChange={setView} />
            {view === "table" && (
              <ExportCsvButton model={table.model} section="velocity" />
            )}
          </>
        ) : undefined
      }
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
    >
      {velocity === null ? (
        <SectionEmpty
          title={
            several
              ? t("analytics:cycles.velocity.singleProjectHint")
              : t("analytics:states.noCycles")
          }
        />
      ) : velocity.length === 0 ? (
        <SectionEmpty title={t("analytics:states.noCycles")} />
      ) : view === "table" && table.model ? (
        <AnalyticsDataTable
          model={table.model}
          sort={table.sort}
          onSortChange={table.setSort}
        />
      ) : (
        <BarChart
          data={points.map((point) => ({
            key: point.id,
            value: point.committed,
            cells: {
              completed: point.completed,
              notCompleted: Math.max(point.committed - point.completed, 0),
            },
          }))}
          series={[
            {
              key: "completed",
              label: completedLabel,
              color: GROUP_CHART_COLORS.completed,
            },
            {
              key: "notCompleted",
              label: notCompletedLabel,
              color: GROUP_CHART_COLORS.backlog,
            },
          ]}
          stacked
          orientation="vertical"
          totalLabel={committedLabel}
          categoryLabel={nameOf}
          categoryLabelWidth={72}
          referenceLine={
            average !== null
              ? {
                  value: average,
                  label: t("analytics:cycles.velocity.average", {
                    value: formatNumber(average),
                  }),
                }
              : undefined
          }
          ariaLabel={t("analytics:a11y.barSummary", {
            metric: completedLabel,
            dimension: t("analytics:dimensions.cycle"),
            count: points.length,
            label: top ? nameOf(top.key) : "",
            value: top?.value ?? 0,
          })}
        />
      )}
    </AnalyticsSection>
  );
}
