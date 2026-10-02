import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { intakeQueryKeys } from "@/hooks/queries/intake/intake-query-keys";
import type { IntakeFilters, IntakeItem, IntakeItemList } from "@/types/intake";

/**
 * Refreshes a project's intake lists and badge, the open requests, and the
 * task's request and history. Only mounted queries refetch.
 */
export function invalidateIntakeQueries(
  queryClient: QueryClient,
  { projectId, taskId }: { projectId: string; taskId?: string | null },
) {
  queryClient.invalidateQueries({ queryKey: intakeQueryKeys.lists(projectId) });
  queryClient.invalidateQueries({
    queryKey: intakeQueryKeys.summary(projectId),
  });
  queryClient.invalidateQueries({ queryKey: intakeQueryKeys.items() });
  if (taskId) {
    queryClient.invalidateQueries({ queryKey: intakeQueryKeys.byTask(taskId) });
    queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
  }
}

/**
 * Writes a changed request into cached list pages: rows whose new status
 * the list doesn't show leave it at once, the others update in place.
 */
export function applyIntakeItemToLists(
  queryClient: QueryClient,
  item: IntakeItem,
) {
  const lists = queryClient.getQueriesData<InfiniteData<IntakeItemList>>({
    queryKey: intakeQueryKeys.lists(item.projectId),
  });
  for (const [key, data] of lists) {
    if (!data) continue;
    const filters = key[2] as IntakeFilters | undefined;
    const keep = filters ? filters.statuses.includes(item.status) : true;
    queryClient.setQueryData<InfiniteData<IntakeItemList>>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: keep
          ? page.items.map((row) => (row.id === item.id ? item : row))
          : page.items.filter((row) => row.id !== item.id),
      })),
    });
  }
}

/** Drops a deleted request from every cached list page. */
export function removeIntakeItemFromLists(
  queryClient: QueryClient,
  projectId: string,
  itemId: string,
) {
  const lists = queryClient.getQueriesData<InfiniteData<IntakeItemList>>({
    queryKey: intakeQueryKeys.lists(projectId),
  });
  for (const [key, data] of lists) {
    if (!data) continue;
    queryClient.setQueryData<InfiniteData<IntakeItemList>>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((row) => row.id !== itemId),
      })),
    });
  }
}
