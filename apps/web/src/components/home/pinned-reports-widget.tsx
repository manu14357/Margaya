import { Link } from "@tanstack/react-router";
import { ChartColumn, PinOff } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import CategoryLabel from "@/components/analytics/category-label";
import { useChartNotes } from "@/components/analytics/custom-chart-card";
import { useLabelOf } from "@/components/analytics/use-label-of";
import BarChart from "@/components/charts/bar-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useToggleHomeReportPin from "@/hooks/mutations/home/use-toggle-home-report-pin";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import { useAnalyticsReports } from "@/hooks/queries/analytics-report/use-analytics-reports";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { buildBarModel } from "@/lib/analytics/chart-model";
import {
  dimensionLabel,
  isDateDimension,
  orientationOf,
} from "@/lib/analytics/dimensions";
import { metricLabel as metricName } from "@/lib/analytics/labels";
import { builderRequestOf } from "@/lib/analytics/report-config";
import { taskSetBase } from "@/lib/analytics/requests";
import { sortBucketsByValue } from "@/lib/analytics/sort";
import { highestBar } from "@/lib/charts/bar-layout";
import { useUserTimeZone } from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { AnalyticsChartRequest } from "@/types/analytics";
import type { AnalyticsReport } from "@/types/analytics-report";
import WidgetSection, { WidgetEmpty, WidgetError } from "./widget-section";

/** Categories a card shows; Home keeps short, and Analytics has the rest. */
const CATEGORY_ROWS = 8;

type WidgetProps = {
  workspaceId: string;
  onOpenTask?: (taskId: string, projectId: string) => void;
};

/**
 * Home: the saved reports you pinned, as their charts. Reports you can no
 * longer see (deleted or made private) drop out by themselves. Shown only to
 * people who may read analytics; nothing is fetched otherwise.
 */
export default function PinnedReportsWidget({ workspaceId }: WidgetProps) {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  if (isCheckingPermissions || !canReadAnalytics()) return null;
  return <PinnedReportsBody workspaceId={workspaceId} />;
}

function PinnedReportsBody({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const reports = useAnalyticsReports(workspaceId);
  const pins = useToggleHomeReportPin(workspaceId);
  const liveIds = (reports.data ?? []).map((report) => report.id);
  const pinned = pins.pinnedIds.flatMap((id) => {
    const report = reports.data?.find((entry) => entry.id === id);
    return report ? [report] : [];
  });

  return (
    <WidgetSection
      title={t("home:widgets.pinnedReports")}
      icon={ChartColumn}
      tone="var(--area-analytics)"
      actions={
        <Button
          variant="ghost"
          size="xs"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/analytics"
              params={{ workspaceId }}
              search={{ tab: "tasks" }}
            />
          }
        >
          {t("home:pinnedReports.openAnalytics")}
        </Button>
      }
    >
      {reports.isPending ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : reports.isError ? (
        <WidgetError
          message={t("home:pinnedReports.loadError")}
          retryLabel={t("analytics:states.retry")}
          onRetry={() => void reports.refetch()}
        />
      ) : pinned.length === 0 ? (
        <WidgetEmpty>{t("home:pinnedReports.empty")}</WidgetEmpty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pinned.map((report) => (
            <PinnedReportCard
              key={report.id}
              report={report}
              onUnpin={() => pins.toggle(report.id, liveIds)}
            />
          ))}
        </div>
      )}
    </WidgetSection>
  );
}

function PinnedReportCard({
  report,
  onUnpin,
}: {
  report: AnalyticsReport;
  onUnpin: () => void;
}) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const timeZone = useUserTimeZone();
  const { config } = report;

  const request = useMemo<AnalyticsChartRequest>(() => {
    const builder = builderRequestOf(config);
    return {
      ...taskSetBase({
        workspaceId: report.workspaceId,
        projectIds: config.scope?.projectIds,
        filters: (config.filters ?? null) as Parameters<
          typeof taskSetBase
        >[0]["filters"],
        archived: config.archived ?? "exclude",
        showSubTasks: builder.showSubTasks,
        weekStartsOn,
        timeZone,
      }),
      xAxis: builder.xAxis,
      segment: builder.segment,
      metric: builder.metric,
      ...(isDateDimension(builder.xAxis)
        ? { dateBucket: builder.dateBucket }
        : {}),
      includeNone: builder.includeNone,
    };
  }, [config, report.workspaceId, weekStartsOn, timeZone]);

  const query = useAnalyticsChart(request);
  const result = query.data;
  const labelOf = useLabelOf(result);
  const metricLabel = metricName(
    result?.metric ?? "taskCount",
    t,
    result?.meta.customFields,
  );
  const dateX = result ? isDateDimension(result.xAxis) : false;
  const sorted = useMemo(() => {
    if (!result) return [];
    return builderRequestOf(config).sortByValue &&
      !isDateDimension(result.xAxis)
      ? sortBucketsByValue(result.buckets)
      : result.buckets;
  }, [result, config]);
  const buckets = dateX ? sorted : sorted.slice(0, CATEGORY_ROWS);
  const model = useMemo(
    () =>
      result ? buildBarModel(result, { labelOf, metricLabel, buckets }) : null,
    [result, labelOf, metricLabel, buckets],
  );
  const notes = useChartNotes(result);
  const top = highestBar(buckets);

  return (
    <article className="min-w-0 space-y-2 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
          {report.name}
        </h3>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label={t("home:pinnedReports.unpin", { name: report.name })}
          title={t("home:pinnedReports.unpin", { name: report.name })}
          onClick={onUnpin}
        >
          <PinOff />
        </Button>
      </div>
      {query.isLoading ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : query.isError && !result ? (
        <WidgetError
          message={t("home:pinnedReports.chartError")}
          retryLabel={t("analytics:states.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : !result || !model || result.totalCount === 0 ? (
        <WidgetEmpty>{t("analytics:states.noTasks")}</WidgetEmpty>
      ) : (
        <>
          <BarChart
            data={model.data}
            series={model.series}
            stacked={model.stacked}
            orientation={orientationOf(result.xAxis)}
            totalLabel={t("analytics:table.total")}
            categoryLabel={(key) =>
              dateX ? (
                labelOf(result.xAxis, key)
              ) : (
                <CategoryLabel
                  dimension={result.xAxis}
                  bucketKey={key}
                  name={labelOf(result.xAxis, key)}
                  meta={result.meta}
                />
              )
            }
            tooltipTitle={(key) => labelOf(result.xAxis, key)}
            ariaLabel={t("analytics:a11y.barSummary", {
              metric: metricLabel,
              dimension: dimensionLabel(
                result.xAxis,
                t,
                result.meta.customFields,
              ),
              count: buckets.length,
              label: top ? labelOf(result.xAxis, top.key) : "",
              value: top?.value ?? 0,
            })}
          />
          {buckets.length < sorted.length && (
            <p className="text-muted-foreground text-xs">
              {t("home:pinnedReports.showing", {
                shown: buckets.length,
                total: sorted.length,
              })}
            </p>
          )}
          {notes.length > 0 && (
            <ul className="grid gap-0.5 text-muted-foreground text-xs">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {report.droppedProjectCount > 0 && (
            <p className="text-muted-foreground text-xs">
              {t("analytics:reports.notes.dropped", {
                count: report.droppedProjectCount,
              })}
            </p>
          )}
        </>
      )}
    </article>
  );
}
