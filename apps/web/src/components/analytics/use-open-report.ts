import { useCallback } from "react";
import {
  defaultTaskQueryState,
  normalizeStoredState,
  TASK_FILTERS_STORAGE_PREFIX,
  type TaskQueryStateHandle,
} from "@/hooks/use-task-query-state";
import { availabilityOf } from "@/lib/analytics/dimensions";
import {
  planReportScope,
  type ReportTarget,
} from "@/lib/analytics/report-config";
import type { DisplayScope } from "@/lib/task-query/display";
import type { ArchivedFilter, FilterNode } from "@/lib/task-query/model";
import type { AnalyticsReport } from "@/types/analytics-report";
import type { AnalyticsScope } from "./analytics-context";

/** The Tasks tab's task-query storage scope for an analytics scope key. */
export function analyticsFiltersStorageScope(scopeKey: string): string {
  return `analytics:${scopeKey}`;
}

/**
 * Stores filters for a scope the page is about to switch to: its task
 * query state loads them from storage when the scope changes. Display
 * settings already stored there are kept.
 */
export function storeTaskSetFor(
  storageScope: string,
  displayScope: DisplayScope,
  taskSet: { filters: FilterNode | null; archived: ArchivedFilter },
) {
  const key = `${TASK_FILTERS_STORAGE_PREFIX}${storageScope}`;
  try {
    const raw = window.localStorage.getItem(key);
    const stored =
      normalizeStoredState(raw ? JSON.parse(raw) : null, displayScope) ??
      defaultTaskQueryState(displayScope);
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, ...stored, ...taskSet }),
    );
  } catch {
    // Storage may be unavailable; the report then opens without filters.
  }
}

/**
 * Applies a report's task set to the Tasks tab: the project selection
 * (workspace analytics) and the toolbar filters. Returns where the builder
 * settings belong and what the scope could not take.
 */
export function useOpenReport({
  scope,
  handle,
  hasContext,
  onClearContext,
}: {
  scope: AnalyticsScope;
  handle: TaskQueryStateHandle;
  /** A cycle or module context is shown; the report replaces it. */
  hasContext: boolean;
  onClearContext: () => void;
}) {
  const { setFilters, setArchived } = handle;
  return useCallback(
    (report: AnalyticsReport): ReportTarget => {
      const selectable = scope.selectableProjects ?? scope.projects;
      const plan = planReportScope(report.config, {
        kind: scope.kind,
        projectId: scope.projectId,
        selectableIds: selectable.map((project) => project.id),
        droppedCount: report.droppedProjectCount,
      });
      const targetProjects =
        scope.kind === "project"
          ? scope.projects
          : plan.projectIds.length
            ? selectable.filter((project) =>
                plan.projectIds.includes(project.id),
              )
            : selectable;
      const filters = (report.config.filters ?? null) as FilterNode | null;
      const archived = report.config.archived ?? "exclude";

      if (hasContext) onClearContext();
      const inPlace = plan.scopeKey === scope.scopeKey || !scope.setProjectIds;
      if (inPlace) {
        setFilters(filters);
        setArchived(archived);
      } else {
        storeTaskSetFor(
          analyticsFiltersStorageScope(plan.scopeKey),
          scope.kind === "project" ? "project" : "workspace",
          { filters, archived },
        );
        scope.setProjectIds?.(plan.projectIds);
      }
      return {
        scopeKey: inPlace ? scope.scopeKey : plan.scopeKey,
        availability: availabilityOf(targetProjects),
        plan,
      };
    },
    [scope, setFilters, setArchived, hasContext, onClearContext],
  );
}
