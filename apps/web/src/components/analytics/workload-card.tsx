import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarChart from "@/components/charts/bar-chart";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import { buildBarModel } from "@/lib/analytics/chart-model";
import { NONE_KEY } from "@/lib/analytics/labels";
import { OPEN_GROUPS_FILTER, taskSetBase } from "@/lib/analytics/requests";
import { sortBucketsByValue } from "@/lib/analytics/sort";
import { breakdownTableModel } from "@/lib/analytics/table-model";
import { highestBar } from "@/lib/charts/bar-layout";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { AnalyticsBucket, AnalyticsChartRequest } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, {
  type SectionView,
  ViewToggle,
} from "./analytics-section";
import CategoryLabel from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { useLabelOf } from "./use-label-of";

const TOP_ASSIGNEES = 10;
const OPEN_GROUPS = ["backlog", "unstarted", "started"] as const;

/** The ten busiest assignees by open tasks, then Unassigned. */
export function workloadBuckets(
  buckets: readonly AnalyticsBucket[],
): AnalyticsBucket[] {
  const sorted = sortBucketsByValue(buckets);
  const named = sorted.filter((bucket) => bucket.key !== NONE_KEY);
  const none = sorted.filter(
    (bucket) => bucket.key === NONE_KEY && bucket.value > 0,
  );
  return [...named.slice(0, TOP_ASSIGNEES), ...none];
}

/** Open tasks per assignee, stacked by group (Overview). */
export default function WorkloadCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const [view, setView] = useState<SectionView>("chart");

  const request = useMemo<AnalyticsChartRequest>(
    () => ({
      ...taskSetBase({
        workspaceId: scope.workspaceId,
        projectIds: scope.projectIds,
        filters: OPEN_GROUPS_FILTER,
        weekStartsOn,
      }),
      xAxis: "assignee",
      segment: "group",
      metric: "taskCount",
    }),
    [scope.workspaceId, scope.projectIds, weekStartsOn],
  );
  const query = useAnalyticsChart(request);
  const result = query.data;
  const labelOf = useLabelOf(result);

  const buckets = useMemo(
    () => (result ? workloadBuckets(result.buckets) : []),
    [result],
  );
  const model = useMemo(
    () =>
      result
        ? buildBarModel(result, {
            labelOf,
            metricLabel: t("analytics:metric.tasks"),
            buckets,
          })
        : null,
    [result, labelOf, buckets, t],
  );
  const tableModel = useMemo(
    () =>
      result
        ? breakdownTableModel(result, {
            t,
            dimensionLabel: t("analytics:dimensions.assignee"),
            labelOf,
            groups: OPEN_GROUPS,
            buckets,
            withProgress: false,
          })
        : null,
    [result, labelOf, buckets, t],
  );
  const table = useSortedTable(tableModel);
  const top = highestBar(buckets);

  return (
    <AnalyticsSection
      title={t("analytics:overview.workload")}
      subtitle={t("analytics:overview.workloadSubtitle")}
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
      isEmpty={buckets.length === 0}
      emptyTitle={t("analytics:states.noTasks")}
      isRefreshing={query.isPlaceholderData}
      className={className}
    >
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
            stacked={model.stacked}
            orientation="horizontal"
            totalLabel={t("analytics:table.total")}
            categoryLabel={(key) => (
              <CategoryLabel
                dimension="assignee"
                bucketKey={key}
                name={labelOf("assignee", key)}
                meta={result.meta}
              />
            )}
            tooltipTitle={(key) => labelOf("assignee", key)}
            ariaLabel={t("analytics:a11y.barSummary", {
              metric: t("analytics:metric.tasks"),
              dimension: t("analytics:dimensions.assignee"),
              count: buckets.length,
              label: top ? labelOf("assignee", top.key) : "",
              value: top?.value ?? 0,
            })}
          />
        )
      )}
    </AnalyticsSection>
  );
}
