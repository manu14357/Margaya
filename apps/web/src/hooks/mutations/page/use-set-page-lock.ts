import { useMutation, useQueryClient } from "@tanstack/react-query";
import lockPage from "@/fetchers/page/lock-page";
import unlockPage from "@/fetchers/page/unlock-page";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import type { Page, PageSummary } from "@/types/page";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string; locked: boolean };
type Context = { detail?: Page; list?: PageSummary[] };

/** Locks or unlocks a page; the flag flips at once and rolls back on error. */
export function useSetPageLock() {
  const queryClient = useQueryClient();

  return useMutation<Page, Error, Variables, Context>({
    mutationFn: ({ pageId, locked }) =>
      locked ? lockPage(pageId) : unlockPage(pageId),
    onMutate: async ({ pageId, projectId, locked }) => {
      const detailKey = pageQueryKeys.detail(pageId);
      const listKey = pageQueryKeys.list(projectId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
        queryClient.cancelQueries({ queryKey: listKey }),
      ]);
      const detail = queryClient.getQueryData<Page>(detailKey);
      const list = queryClient.getQueryData<PageSummary[]>(listKey);
      queryClient.setQueryData<Page>(detailKey, (page) =>
        page ? { ...page, isLocked: locked } : page,
      );
      queryClient.setQueryData<PageSummary[]>(listKey, (pages) =>
        pages?.map((page) =>
          page.id === pageId ? { ...page, isLocked: locked } : page,
        ),
      );
      return { detail, list };
    },
    onError: (_error, { pageId, projectId }, context) => {
      if (context?.detail) {
        queryClient.setQueryData(pageQueryKeys.detail(pageId), context.detail);
      }
      if (context?.list) {
        queryClient.setQueryData(pageQueryKeys.list(projectId), context.list);
      }
    },
    onSettled: (_page, _error, { pageId, projectId }) => {
      invalidatePageQueries(queryClient, { projectIds: [projectId], pageId });
    },
  });
}

export default useSetPageLock;
