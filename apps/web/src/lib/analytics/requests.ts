import type { FilterNode } from "@/lib/task-query/model";
import { queryContext, type WeekStart } from "@/lib/task-query/request";
import type { AnalyticsTaskSet } from "@/types/analytics";

// The task set every Tasks-tab section shares (B8 §4.5): one base request,
// from which the tiles, the trend, the builder and the breakdown derive, so
// all of them count the same tasks.

type TaskSetArgs = {
  workspaceId: string;
  projectIds?: readonly string[];
  filters?: FilterNode | null;
  archived?: AnalyticsTaskSet["archived"];
  showSubTasks?: boolean;
  weekStartsOn: WeekStart;
  /** Defaults to the user's zone (`userTimeZone()`). */
  timeZone?: string;
};

export function taskSetBase({
  workspaceId,
  projectIds,
  filters = null,
  archived = "exclude",
  showSubTasks = true,
  weekStartsOn,
  timeZone,
}: TaskSetArgs): AnalyticsTaskSet {
  return {
    workspaceId,
    ...(projectIds?.length ? { scope: { projectIds: [...projectIds] } } : {}),
    filters: filters as AnalyticsTaskSet["filters"],
    archived,
    showSubTasks,
    context: queryContext(weekStartsOn, timeZone),
  };
}
