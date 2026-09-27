import { keepPreviousData, useQuery } from "@tanstack/react-query";
import queryTasks from "@/fetchers/task-query/query-tasks";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { scopeKeyOf, taskQueryKeys } from "@/lib/task-query/cache";
import { browserTimeZone } from "@/lib/task-query/request";
import type { TaskQueryRequest } from "@/types/task-query";
import type { FilterOption } from "./registry";

const PARENT_SEARCH_LIMIT = 20;

/** Tasks whose title or key matches the search, as parent options. */
export function useParentSearchOptions(
  workspaceId: string,
  projectIds: readonly string[] | undefined,
  search: string,
): { options: FilterOption[]; isLoading: boolean } {
  const trimmed = search.trim();
  const request: TaskQueryRequest = {
    workspaceId,
    ...(projectIds?.length ? { scope: { projectIds: [...projectIds] } } : {}),
    search: trimmed,
    archived: "include",
    display: { orderBy: { field: "updatedAt", direction: "desc" } },
    page: { limit: PARENT_SEARCH_LIMIT },
    mode: "rows",
    context: { timeZone: browserTimeZone() },
  };
  const { data, isFetching } = useQuery({
    queryKey: taskQueryKeys.request(
      workspaceId,
      scopeKeyOf(projectIds),
      "rows",
      { ...request, purpose: "parent-options" },
    ),
    queryFn: ({ signal }) => queryTasks(request, signal),
    enabled: Boolean(workspaceId) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const ids = data?.groups[0]?.taskIds ?? [];
  return {
    options: trimmed
      ? ids.flatMap((id) => {
          const row = data?.tasks[id];
          return row
            ? [
                {
                  value: row.id,
                  label: row.title,
                  icon: (
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {row.key}
                    </span>
                  ),
                },
              ]
            : [];
        })
      : [],
    isLoading: isFetching,
  };
}

/** A hook bound to one scope, for a subject's typed search. */
export function makeParentSearchHook(
  workspaceId: string,
  projectIds: readonly string[] | undefined,
) {
  return function useParentSearch(search: string) {
    return useParentSearchOptions(workspaceId, projectIds, search);
  };
}

/** A parent filter value: the task's title once it loads. */
export function ParentTaskLabel({ value }: { value: string }) {
  const { data: task } = useGetTask(value);
  return <>{task?.title ?? value}</>;
}
