import type { SQL } from "drizzle-orm";
import { boundedTaskRead, type TaskReadDatabase } from "../task/bounded-read";
import { compileTaskScope } from "../task-query/compile";
import { buildQueryContext, type QueryContext } from "../task-query/context";
import type { WeekStart } from "../task-query/dates";
import type { ArchivedFilter, FilterNode } from "../task-query/schema";
import { filterConditions, validateFilterTree } from "../task-query/validate";
import { ANALYTICS_TIMEOUT } from "./schema";

// The one place analytics talks to the task query engine (K2): the scope
// projects with their flags, and the task set S as one SQL condition with
// exactly the engine's semantics (scope, never triage, archived rule,
// sub-task rule, filters).

export type AnalyticsCaller = {
  workspaceId: string;
  userId: string;
  /** Visible projects whose project role refuses the read: left out. */
  excludedProjectIds?: readonly string[];
};

export type TaskSetInput = {
  scope?: { projectIds?: string[] };
  filters?: FilterNode | null;
  archived?: ArchivedFilter;
  showSubTasks?: boolean;
  context?: { timeZone?: string; weekStartsOn?: WeekStart };
};

/** Every read of an analytics request: read only, bounded, 503 on timeout. */
export function analyticsRead<T>(
  read: (tx: TaskReadDatabase) => Promise<T>,
): Promise<T> {
  return boundedTaskRead(read, ANALYTICS_TIMEOUT);
}

/** 400 for a filter tree the engine cannot run, before any read. */
export function assertRunnableFilters(filters: FilterNode | null | undefined) {
  validateFilterTree(filters);
}

/**
 * Scope projects (404 for one outside the workspace, 400 for a bad time
 * zone or custom field), the caller and today: two statements (the
 * workspace's zone with the caller's hidden projects, then the projects),
 * one more when the filters use custom fields and one more when the chart
 * does. Charted fields load from the scope projects only, so a field of a
 * project the caller can't see reads as unknown.
 */
export function loadAnalyticsContext(
  tx: TaskReadDatabase,
  caller: AnalyticsCaller,
  {
    projectIds,
    timeZone,
    weekStartsOn,
    filters,
    chartFieldIds,
  }: {
    projectIds?: readonly string[];
    timeZone?: string;
    weekStartsOn?: WeekStart;
    filters?: FilterNode | null;
    /** Custom fields the chart groups by or sums. */
    chartFieldIds?: readonly string[];
  } = {},
): Promise<QueryContext> {
  return buildQueryContext(tx, {
    workspaceId: caller.workspaceId,
    userId: caller.userId,
    excludeProjectIds: caller.excludedProjectIds,
    projectIds,
    timeZone,
    weekStartsOn,
    customFieldIds: filterConditions(filters)
      .filter((condition) => condition.key === "customField")
      .map((condition) => condition.fieldId ?? ""),
    displayFieldIds: chartFieldIds,
  });
}

/** The context of a request carrying the task set fields. */
export function loadTaskSetContext(
  tx: TaskReadDatabase,
  caller: AnalyticsCaller,
  input: TaskSetInput,
  chartFieldIds?: readonly string[],
): Promise<QueryContext> {
  return loadAnalyticsContext(tx, caller, {
    projectIds: input.scope?.projectIds,
    timeZone: input.context?.timeZone,
    weekStartsOn: input.context?.weekStartsOn,
    filters: input.filters,
    chartFieldIds,
  });
}

/** S as a condition on `task` (with `column` LEFT JOINed). */
export function taskSetCondition(
  context: QueryContext,
  input: TaskSetInput = {},
): SQL {
  return compileTaskScope({
    context,
    filters: input.filters,
    archived: input.archived ?? "exclude",
    showSubTasks: input.showSubTasks ?? true,
  });
}

export type ScopeFeature = "cycles" | "modules" | "intake" | "estimates";

const FEATURE_FLAG = {
  cycles: "cyclesEnabled",
  modules: "modulesEnabled",
  intake: "intakeEnabled",
  estimates: "estimatesEnabled",
} as const;

/** Scope projects with the feature on, in sidebar order. */
export function projectsWithFeature(
  context: QueryContext,
  feature: ScopeFeature,
): string[] {
  return context.projects
    .filter((project) => project[FEATURE_FLAG[feature]])
    .map((project) => project.id);
}

export type ProjectMetaEntry = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
};

/** Display data of scope projects (all, or the given ids), in sidebar order. */
export function projectsMeta(
  context: QueryContext,
  ids?: Iterable<string>,
): ProjectMetaEntry[] {
  const wanted = ids ? new Set(ids) : null;
  return context.projects
    .filter((project) => !wanted || wanted.has(project.id))
    .map(({ id, name, slug, icon }) => ({ id, name, slug, icon }));
}

/** Position of each scope project in sidebar order. */
export function projectRank(context: QueryContext): Map<string, number> {
  return new Map(context.projectIds.map((id, index) => [id, index]));
}
