import { useUserPreferencesStore } from "@/store/user-preferences";
import type { TaskQueryInclude, TaskQueryRequest } from "@/types/task-query";
import { withBaseConditions } from "./filter-tree";
import type { FilterCondition, TaskQueryScope, TaskQueryState } from "./model";

// Builds engine requests from a list's state. Date filters compare calendar
// days in the user's time zone (the account zone when chosen, else the
// browser's) and week start (B4 K4).

export type WeekStart = 0 | 1 | 6;

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The zone task queries count days in: the account's, else the browser's. */
export function userTimeZone(): string {
  return useUserPreferencesStore.getState().timeZone ?? browserTimeZone();
}

/** `userTimeZone()` as a hook, so a request rebuilds when the zone loads. */
export function useUserTimeZone(): string {
  const timeZone = useUserPreferencesStore((state) => state.timeZone);
  return timeZone ?? browserTimeZone();
}

export function queryContext(
  weekStartsOn: WeekStart,
  timeZone: string = userTimeZone(),
) {
  return { timeZone, weekStartsOn };
}

export function scopeProjectIds(scope: TaskQueryScope): string[] | undefined {
  if (scope.kind === "project") return [scope.projectId];
  return scope.projectIds?.length ? [...scope.projectIds] : undefined;
}

/** The row data list renderers and the spreadsheet show. */
export const ROW_INCLUDES: readonly TaskQueryInclude[] = [
  "assignees",
  "labels",
  "cycle",
  "modules",
  "estimate",
  "subTasks",
];

type BuildArgs = {
  workspaceId: string;
  scope: TaskQueryScope;
  state: Pick<TaskQueryState, "filters" | "archived" | "display"> &
    Partial<Pick<TaskQueryState, "displayProperties">>;
  /** Hidden conditions the page adds (its cycle, "assigned to me"). */
  baseConditions?: readonly FilterCondition[];
  search?: string;
  weekStartsOn: WeekStart;
  /** Defaults to `userTimeZone()`. */
  timeZone?: string;
};

/** A rows request: groups with their first page of rows. */
export function buildRowsRequest({
  workspaceId,
  scope,
  state,
  baseConditions = [],
  search,
  weekStartsOn,
  timeZone,
  limit,
  ungrouped = false,
}: BuildArgs & { limit: number; ungrouped?: boolean }): TaskQueryRequest {
  const projectIds = scopeProjectIds(scope);
  const filters = withBaseConditions(state.filters, baseConditions);
  const include: TaskQueryInclude[] = [...ROW_INCLUDES];
  if (
    scope.kind === "project" &&
    (state.displayProperties?.customFields.length ?? 0) > 0
  ) {
    include.push("customFields");
  }
  const trimmed = search?.trim();
  return {
    workspaceId,
    ...(projectIds ? { scope: { projectIds } } : {}),
    filters,
    archived: state.archived,
    ...(trimmed ? { search: trimmed } : {}),
    display: {
      groupBy: ungrouped ? null : state.display.groupBy,
      subGroupBy: ungrouped ? null : state.display.subGroupBy,
      orderBy: state.display.orderBy,
      showSubTasks: state.display.showSubTasks,
      showEmptyGroups: ungrouped ? false : state.display.showEmptyGroups,
    },
    include,
    page: { limit },
    mode: "rows",
    context: queryContext(weekStartsOn, timeZone),
  };
}

/** An ids request: every matching task id, for filtering a loaded board. */
export function buildIdsRequest({
  workspaceId,
  scope,
  state,
  baseConditions = [],
  weekStartsOn,
  timeZone,
}: BuildArgs): TaskQueryRequest {
  const projectIds = scopeProjectIds(scope);
  return {
    workspaceId,
    ...(projectIds ? { scope: { projectIds } } : {}),
    filters: withBaseConditions(state.filters, baseConditions),
    archived: state.archived,
    display: { showSubTasks: state.display.showSubTasks },
    mode: "ids",
    context: queryContext(weekStartsOn, timeZone),
  };
}

/** The request without its page, for cache keys. */
export function withoutPage(request: TaskQueryRequest): TaskQueryRequest {
  const { page: _page, ...rest } = request;
  return rest;
}
