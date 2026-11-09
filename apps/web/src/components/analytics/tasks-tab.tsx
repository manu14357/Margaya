import { X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskToolbar from "@/components/task-filters/task-toolbar";
import { Card } from "@/components/ui/card";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useGetCycle from "@/hooks/queries/cycle/use-get-cycle";
import useGetModule from "@/hooks/queries/module/use-get-module";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { availabilityOf } from "@/lib/analytics/dimensions";
import type { ReportTaskSet } from "@/lib/analytics/report-config";
import { taskSetBase } from "@/lib/analytics/requests";
import {
  COLUMN_GROUP_META,
  CREATABLE_COLUMN_GROUPS,
} from "@/lib/column-groups";
import {
  mergeBaseConditions,
  withBaseConditions,
} from "@/lib/task-query/filter-tree";
import type { FilterCondition, TaskQueryScope } from "@/lib/task-query/model";
import { useUserTimeZone } from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { AnalyticsChartRequest } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import { SectionError } from "./analytics-section";
import BreakdownCard from "./breakdown-card";
import CustomChartCard from "./custom-chart-card";
import { KpiRow, KpiTile } from "./kpi-tile";
import TrendCard from "./trend-card";
import { analyticsFiltersStorageScope, useOpenReport } from "./use-open-report";

/** The removable "Cycle: Sprint 4" chip of a cycle or module context. */
function ContextChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-7 max-w-64 items-center rounded-md border border-primary/30 bg-primary/10 text-primary text-xs">
      <span className="truncate px-2 font-medium">{label}</span>
      <button
        type="button"
        aria-label={t("analytics:context.remove", { name: label })}
        onClick={onRemove}
        className="inline-flex h-full w-7 shrink-0 items-center justify-center rounded-r-md hover:bg-primary/15"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

type TasksTabProps = {
  /** Project scope: counts only this cycle's (or module's) tasks. */
  cycleId?: string;
  moduleId?: string;
  onClearContext: () => void;
};

/** Filters, headline numbers, the trend, the builder and the breakdown. */
export default function TasksTab({
  cycleId,
  moduleId,
  onClearContext,
}: TasksTabProps) {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const timeZone = useUserTimeZone();
  const handle = useTaskQueryState({
    storageScope: analyticsFiltersStorageScope(scope.scopeKey),
    scope: scope.kind === "project" ? "project" : "workspace",
    workspaceId: scope.workspaceId,
  });
  const toolbarScope = useMemo<TaskQueryScope>(
    () =>
      scope.kind === "project" && scope.projectId
        ? { kind: "project", projectId: scope.projectId }
        : { kind: "workspace", projectIds: scope.projectIds },
    [scope.kind, scope.projectId, scope.projectIds],
  );

  const projectId = scope.projectId ?? "";
  const cycle = useGetCycle(projectId, cycleId ?? "");
  const module = useGetModule(projectId, moduleId ?? "");
  const contextConditions = useMemo<FilterCondition[]>(() => {
    if (cycleId) return [{ key: "cycle", operator: "in", values: [cycleId] }];
    if (moduleId)
      return [{ key: "module", operator: "in", values: [moduleId] }];
    return [];
  }, [cycleId, moduleId]);
  const contextLabel = cycleId
    ? t("analytics:context.cycle", { name: cycle.data?.name ?? "…" })
    : moduleId
      ? t("analytics:context.module", { name: module.data?.name ?? "…" })
      : null;
  const cycleRange =
    cycle.data?.startDate && cycle.data.endDate
      ? { from: cycle.data.startDate, to: cycle.data.endDate }
      : null;

  const filters = useMemo(
    () => withBaseConditions(handle.filters, contextConditions),
    [handle.filters, contextConditions],
  );
  const showSubTasks = handle.display.showSubTasks;
  const base = useMemo(
    () =>
      taskSetBase({
        workspaceId: scope.workspaceId,
        projectIds: scope.projectIds,
        filters,
        archived: handle.archived,
        showSubTasks,
        weekStartsOn,
        timeZone,
      }),
    [
      scope.workspaceId,
      scope.projectIds,
      filters,
      handle.archived,
      showSubTasks,
      weekStartsOn,
      timeZone,
    ],
  );
  // With one project in scope, its custom fields can be charted too.
  const fieldsQuery = useGetCustomFieldsByProject(
    scope.projects.length === 1 ? (scope.projects[0]?.id ?? "") : "",
  );
  const fieldRows = fieldsQuery.isError ? [] : fieldsQuery.data;
  const availability = useMemo(
    () =>
      availabilityOf(
        scope.projects,
        fieldRows?.map(({ id, name, type }) => ({ id, name, type })),
      ),
    [scope.projects, fieldRows],
  );
  const pointsPossible = availability.features.estimates;

  // A saved report keeps the context as editable filter chips.
  const reportTaskSet = useMemo<ReportTaskSet>(
    () => ({
      scope: base.scope,
      filters: mergeBaseConditions(
        handle.filters,
        contextConditions,
      ) as ReportTaskSet["filters"],
      archived: handle.archived,
    }),
    [base.scope, handle.filters, contextConditions, handle.archived],
  );
  const openReport = useOpenReport({
    scope,
    handle,
    hasContext: contextConditions.length > 0,
    onClearContext,
  });
  const reports = useMemo(
    () => ({ taskSet: reportTaskSet, onOpen: openReport }),
    [reportTaskSet, openReport],
  );

  const kpiRequest = useMemo<AnalyticsChartRequest>(
    () => ({ ...base, xAxis: "group", metric: "taskCount" }),
    [base],
  );
  const kpi = useAnalyticsChart(kpiRequest);
  const counts = (key: string) =>
    kpi.data?.buckets.find((bucket) => bucket.key === key)?.value ?? 0;
  const total = kpi.data?.totalCount ?? 0;
  const committed = total - counts("cancelled");

  return (
    <div className="flex min-h-0 flex-col">
      <TaskToolbar
        workspaceId={scope.workspaceId}
        scope={toolbarScope}
        handle={handle}
        displayConfig={null}
        leftSlot={
          contextLabel ? (
            <ContextChip label={contextLabel} onRemove={onClearContext} />
          ) : undefined
        }
        status={{ isFetching: kpi.isFetching }}
      />
      <div className="mx-auto grid w-full max-w-7xl gap-3 px-4 py-4 md:px-6 md:py-5">
        {kpi.error ? (
          <Card className="p-4">
            <SectionError
              error={kpi.error}
              onRetry={() => void kpi.refetch()}
            />
          </Card>
        ) : (
          <KpiRow>
            <KpiTile
              label={t("analytics:kpi.total")}
              value={total}
              isLoading={kpi.isLoading}
            />
            {CREATABLE_COLUMN_GROUPS.map((group) => (
              <KpiTile
                key={group}
                label={t(COLUMN_GROUP_META[group].labelKey)}
                value={counts(group)}
                isLoading={kpi.isLoading}
              />
            ))}
            <KpiTile
              label={t("analytics:kpi.completion")}
              value={`${kpi.data?.progress ?? 0}%`}
              detail={t("analytics:kpi.completionDetail", {
                completed: counts("completed"),
                committed,
              })}
              isLoading={kpi.isLoading}
            />
          </KpiRow>
        )}
        <TrendCard
          key={cycleRange ? `${cycleRange.from}:${cycleRange.to}` : "default"}
          base={base}
          initialRange={cycleRange}
          pointsPossible={pointsPossible}
        />
        <CustomChartCard
          base={base}
          availability={availability}
          pointsPossible={pointsPossible}
          reports={reports}
        />
        <BreakdownCard base={base} availability={availability} />
      </div>
    </div>
  );
}
