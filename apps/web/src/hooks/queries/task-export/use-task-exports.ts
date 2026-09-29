import { useInfiniteQuery } from "@tanstack/react-query";
import listTaskExports from "@/fetchers/task-export/list-task-exports";
import { isExportActive } from "@/lib/task-export/status";
import type { TaskExportScope } from "@/types/task-export";
import { taskExportQueryKeys } from "./task-export-query-keys";

const ACTIVE_POLL_MS = 5_000;

/**
 * A workspace's export history, newest first, a page at a time. It polls
 * every 5 s while a loaded row is queued or processing, a fallback for the
 * EXPORT_UPDATED socket message.
 */
export function useTaskExports(
  workspaceId: string | undefined,
  scope: TaskExportScope,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: taskExportQueryKeys.list(workspaceId ?? "", scope),
    queryFn: ({ pageParam }) =>
      listTaskExports({
        workspaceId: workspaceId ?? "",
        scope,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId) && enabled,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some(isExportActive))
        ? ACTIVE_POLL_MS
        : false,
  });
}

export default useTaskExports;
