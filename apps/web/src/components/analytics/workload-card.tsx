import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarChart from "@/components/charts/bar-chart";
import { useAnalyticsWorkload } from "@/hooks/queries/analytics/use-analytics-workload";
import {
  isOverloaded,
  memberKey,
  workloadChartModel,
  workloadTableModel,
} from "@/lib/analytics/workload-model";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, {
  type SectionView,
  ViewToggle,
} from "./analytics-section";
import CategoryLabel from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { useLabelOf } from "./use-label-of";

/**
 * Open work per person, in estimate points when most of it is sized and in
 * tasks otherwise, stacked by group (Overview). People allowed to plan also
 * see who holds more than they usually finish; the table lists everyone.
 */
export default function WorkloadCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const [view, setView] = useState<SectionView>("chart");

  const query = useAnalyticsWorkload({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
  });
  const result = query.data;
  const labelOf = useLabelOf(result);
  const isPoints = result?.unit === "points";
  const metricLabel = isPoints
    ? t("analytics:metric.points")
    : t("analytics:metric.tasks");

  const model = useMemo(
    () => (result ? workloadChartModel(result, { labelOf }) : null),
    [result, labelOf],
  );
  const tableModel = useMemo(
    () =>
      result ? workloadTableModel(result, { t, labelOf, metricLabel }) : null,
    [result, t, labelOf, metricLabel],
  );
  const table = useSortedTable(tableModel);

  const overloaded = useMemo(
    () => (result?.members ?? []).filter(isOverloaded),
    [result],
  );
  const overKeys = useMemo(
    () => new Set(overloaded.map(memberKey)),
    [overloaded],
  );
  const hasCheck = Boolean(result?.members.some((member) => member.check));
  const usualWeeks = (result?.usualDays ?? 28) / 7;
  const historyWeeks = (result?.historyDays ?? 56) / 7;
  const top = model?.data[0];

  return (
    <AnalyticsSection
      title={t("analytics:overview.workload")}
      subtitle={
        isPoints
          ? t("analytics:overview.workloadSubtitlePoints")
          : t("analytics:overview.workloadSubtitle")
      }
      actions={
        <>
          <ViewToggle value={view} onChange={setView} />
          {view === "table" && (
            <ExportCsvButton model={table.model} section="workload" />
          )}
        </>
      }
      isLoading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!result || result.members.length === 0}
      emptyTitle={t("analytics:states.noTasks")}
      isRefreshing={query.isPlaceholderData}
      className={className}
    >
      <div className="grid gap-3">
        {overloaded.length > 0 && (
          <p className="flex items-start gap-1.5 text-foreground text-sm">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-destructive"
            />
            <span>
              {t("analytics:overview.overloaded", {
                count: overloaded.length,
                names: overloaded
                  .map((member) => labelOf("assignee", memberKey(member)))
                  .join(", "),
                weeks: usualWeeks,
              })}
            </span>
          </p>
        )}
        {view === "table" && table.model ? (
          <AnalyticsDataTable
            model={table.model}
            sort={table.sort}
            onSortChange={table.setSort}
            renderCell={(column, row) =>
              column.id === "name" && result ? (
                <CategoryLabel
                  dimension="assignee"
                  bucketKey={row.key}
                  name={labelOf("assignee", row.key)}
                  meta={result.meta}
                />
              ) : undefined
            }
          />
        ) : (
          model &&
          result && (
            <BarChart
              data={model.data}
              series={model.series}
              stacked
              orientation="horizontal"
              totalLabel={t("analytics:table.total")}
              categoryLabel={(key) => (
                <span className="inline-flex max-w-full items-center gap-1">
                  {overKeys.has(key) && (
                    <TriangleAlert
                      role="img"
                      aria-label={t("analytics:overview.overUsual")}
                      className="size-3 shrink-0 text-destructive"
                    />
                  )}
                  <CategoryLabel
                    dimension="assignee"
                    bucketKey={key}
                    name={labelOf("assignee", key)}
                    meta={result.meta}
                  />
                </span>
              )}
              tooltipTitle={(key) =>
                overKeys.has(key)
                  ? t("analytics:overview.overTooltip", {
                      name: labelOf("assignee", key),
                    })
                  : labelOf("assignee", key)
              }
              ariaLabel={t("analytics:a11y.barSummary", {
                metric: metricLabel,
                dimension: t("analytics:dimensions.assignee"),
                count: model.data.length,
                label: top ? labelOf("assignee", top.key) : "",
                value: top?.value ?? 0,
              })}
            />
          )
        )}
        {hasCheck && (
          <p className="text-muted-foreground text-xs">
            {t("analytics:overview.usualHint", {
              usualWeeks,
              historyWeeks,
            })}
          </p>
        )}
      </div>
    </AnalyticsSection>
  );
}
