import { useInfiniteQuery } from "@tanstack/react-query";
import listTaskDrafts from "@/fetchers/task-draft/list-task-drafts";
import type { TaskDraftFilters } from "@/types/task-draft";
import { taskDraftQueryKeys } from "./task-draft-query-keys";

/** The caller's drafts under the page's filters, 50 at a time. */
export function useTaskDrafts(workspaceId: string, filters: TaskDraftFilters) {
  return useInfiniteQuery({
    queryKey: taskDraftQueryKeys.list(workspaceId, filters),
    queryFn: ({ pageParam }) => listTaskDrafts(workspaceId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: Boolean(workspaceId),
  });
}

export default useTaskDrafts;
