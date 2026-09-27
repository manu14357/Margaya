import { keepPreviousData, useQuery } from "@tanstack/react-query";
import queryTasks from "@/fetchers/task-query/query-tasks";
import {
  scopeKeyOf,
  taskQueryKeys,
  WORKSPACE_SCOPE_KEY,
} from "@/lib/task-query/cache";
import type { TaskQueryRequest } from "@/types/task-query";

export type TaskQueryIds = {
  ids: ReadonlySet<string>;
  truncated: boolean;
  totalCount: number;
};

/**
 * Every task id matching a request (ids mode), for filtering an already
 * loaded board (B4 K9). The previous ids stay while new filters load.
 */
export function useTaskQueryIds(
  request: TaskQueryRequest | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const scopeKey = scopeKeyOf(request?.scope?.projectIds);
  return useQuery({
    queryKey: taskQueryKeys.request(
      request?.workspaceId ?? "",
      scopeKey,
      "ids",
      request,
    ),
    queryFn: ({ signal }) => {
      if (!request) throw new Error("No task query");
      return queryTasks(request, signal);
    },
    enabled: Boolean(request?.workspaceId) && enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: scopeKey === WORKSPACE_SCOPE_KEY,
    select: (data): TaskQueryIds => ({
      ids: new Set(data.ids ?? []),
      truncated: data.truncated ?? false,
      totalCount: data.totalCount,
    }),
  });
}

export default useTaskQueryIds;
