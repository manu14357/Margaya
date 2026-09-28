import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import type { TaskDraftList } from "@/types/task-draft";

type Snapshot = Array<[readonly unknown[], unknown]>;

/**
 * Removes a draft from every cached list page and lowers the count. Returns
 * what was there, so a failed request can put it back.
 */
export function removeDraftFromCache(
  queryClient: QueryClient,
  workspaceId: string,
  draftId: string,
): Snapshot {
  const snapshot: Snapshot = [];

  for (const [key, data] of queryClient.getQueriesData<
    InfiniteData<TaskDraftList>
  >({ queryKey: taskDraftQueryKeys.lists(workspaceId) })) {
    if (!data) continue;
    snapshot.push([key, data]);
    const pages = data.pages.map((page) => {
      const drafts = page.drafts.filter((draft) => draft.id !== draftId);
      if (drafts.length === page.drafts.length) return page;
      return { ...page, drafts, total: Math.max(0, page.total - 1) };
    });
    queryClient.setQueryData(key, { ...data, pages });
  }

  const countKey = taskDraftQueryKeys.count(workspaceId);
  const count = queryClient.getQueryData<{ count: number }>(countKey);
  if (count) {
    snapshot.push([countKey, count]);
    queryClient.setQueryData(countKey, {
      count: Math.max(0, count.count - 1),
    });
  }

  return snapshot;
}

export function restoreDraftCache(
  queryClient: QueryClient,
  snapshot: Snapshot,
) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}
