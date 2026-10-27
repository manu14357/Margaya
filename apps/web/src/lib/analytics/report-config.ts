import { isSameValue } from "@/lib/task-query/filter-tree";
import type { AnalyticsReportConfig } from "@/types/analytics-report";
import {
  type BuilderAvailability,
  type BuilderState,
  defaultSortByValue,
  normalizeBuilderState,
} from "./builder-state";
import { type DimensionAvailability, isDateDimension } from "./dimensions";
import { analyticsScopeKey } from "./scope-key";

// Saved analytics reports (B8 §1.5): the builder's settings plus the task
// set it counted (scope, filters, archived). Pure conversions between a
// report's configuration, the builder state and the page's scope.

/** The task set part of a report: what the Tasks tab's toolbar holds. */
export type ReportTaskSet = Pick<
  AnalyticsReportConfig,
  "scope" | "filters" | "archived"
>;

/** The configuration a save stores for this task set and builder state. */
export function reportConfigOf(
  taskSet: ReportTaskSet,
  state: BuilderState,
): AnalyticsReportConfig {
  const projectIds = taskSet.scope?.projectIds;
  return {
    ...(projectIds?.length
      ? { scope: { projectIds: [...new Set(projectIds)].sort() } }
      : {}),
    filters: taskSet.filters ?? null,
    archived: taskSet.archived ?? "exclude",
    showSubTasks: state.showSubTasks,
    xAxis: state.xAxis,
    segment: state.segment,
    metric: state.metric,
    ...(isDateDimension(state.xAxis) ? { dateBucket: state.dateBucket } : {}),
    includeNone: state.includeNone,
    sortByValue: state.sortByValue,
  };
}

/** A saved configuration's builder settings, with omitted fields defaulted. */
export function builderRequestOf(config: AnalyticsReportConfig) {
  return {
    xAxis: config.xAxis,
    segment: config.segment ?? null,
    metric: config.metric ?? "taskCount",
    dateBucket: config.dateBucket ?? "month",
    includeNone: config.includeNone ?? true,
    sortByValue: config.sortByValue ?? defaultSortByValue(config.xAxis),
    showSubTasks: config.showSubTasks ?? true,
  };
}

/** The same configuration whichever optional fields were spelled out. */
export function canonicalReportConfig(
  config: AnalyticsReportConfig,
): AnalyticsReportConfig {
  return reportConfigOf(config, builderRequestOf(config) as BuilderState);
}

export function isSameReportConfig(
  a: AnalyticsReportConfig,
  b: AnalyticsReportConfig,
): boolean {
  return isSameValue(canonicalReportConfig(a), canonicalReportConfig(b));
}

/**
 * The builder state a report opens with where it is opened. `reset` tells
 * whether its x-axis, segment or metric isn't offered here and fell back.
 */
export function builderStateOfReport(
  config: AnalyticsReportConfig,
  availability: BuilderAvailability,
): { state: BuilderState; reset: boolean } {
  const requested = builderRequestOf(config);
  const state = normalizeBuilderState(requested, availability);
  const reset =
    state.xAxis !== requested.xAxis ||
    state.segment !== requested.segment ||
    state.metric !== requested.metric;
  return { state, reset };
}

export type ReportScopePlan = {
  /** Workspace analytics: the project selection to show ([] for all). */
  projectIds: string[];
  /** The analytics scope key the report opens in. */
  scopeKey: string;
  /** Saved projects that can't be selected here (archived since). */
  leftOutCount: number;
  /** Workspace analytics: none of its projects remain, so all show. */
  allProjects: boolean;
  /** Project analytics: the report was saved for other projects. */
  otherProjects: boolean;
};

/**
 * Where a report opens. Workspace analytics selects its projects (those
 * still selectable); project analytics keeps its one project.
 */
export function planReportScope(
  config: AnalyticsReportConfig,
  page: {
    kind: "workspace" | "project";
    projectId?: string;
    /** The projects the workspace selector offers. */
    selectableIds: readonly string[];
    /** Projects the API dropped from the saved scope. */
    droppedCount?: number;
  },
): ReportScopePlan {
  const saved = config.scope?.projectIds ?? [];
  if (page.kind === "project") {
    const ids = page.projectId ? [page.projectId] : [];
    return {
      projectIds: ids,
      scopeKey: analyticsScopeKey(ids),
      leftOutCount: 0,
      allProjects: false,
      otherProjects: !(saved.length === 1 && saved[0] === page.projectId),
    };
  }
  const kept = saved.filter((id) => page.selectableIds.includes(id));
  return {
    projectIds: kept,
    scopeKey: analyticsScopeKey(kept),
    leftOutCount: saved.length - kept.length,
    allProjects:
      kept.length === 0 && (saved.length > 0 || (page.droppedCount ?? 0) > 0),
    otherProjects: false,
  };
}

/** Where an opened report's builder settings go, and how it was scoped. */
export type ReportTarget = {
  scopeKey: string;
  /** What the scope the report opens in offers. */
  availability: DimensionAvailability;
  plan: ReportScopePlan;
};

/** What could not be applied when a report opened, for the notes. */
export type ReportNote =
  | { kind: "dropped"; count: number }
  | { kind: "leftOut"; count: number }
  | { kind: "allProjects" }
  | { kind: "otherProjects" }
  | { kind: "builderReset" };

export function reportNotes(
  plan: ReportScopePlan,
  { droppedCount = 0, builderReset = false } = {},
): ReportNote[] {
  const notes: ReportNote[] = [];
  if (droppedCount > 0) notes.push({ kind: "dropped", count: droppedCount });
  if (plan.leftOutCount > 0) {
    notes.push({ kind: "leftOut", count: plan.leftOutCount });
  }
  if (plan.allProjects) notes.push({ kind: "allProjects" });
  if (plan.otherProjects) notes.push({ kind: "otherProjects" });
  if (builderReset) notes.push({ kind: "builderReset" });
  return notes;
}
