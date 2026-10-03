import { useMutation, useQueryClient } from "@tanstack/react-query";
import movePageInTree from "@/fetchers/page/move-page-in-tree";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { applyPageMove } from "@/lib/pages/build-page-tree";
import type { PageSummary } from "@/types/page";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = {
  pageId: string;
  projectId: string;
  parentId: string | null;
  afterId: string | null;
};

type Context = { list?: PageSummary[] };

/**
 * Moves a page within the tree. The list cache is reordered at once with
 * the server's renumbering rule, and restored if the move is refused.
 */
export function useMovePageInTree() {
  const queryClient = useQueryClient();

  return useMutation<PageSummary, Error, Variables, Context>({
    mutationFn: ({ pageId, parentId, afterId }) =>
      movePageInTree(pageId, { parentId, afterId }),
    onMutate: async ({ pageId, projectId, parentId, afterId }) => {
      const listKey = pageQueryKeys.list(projectId);
      await queryClient.cancelQueries({ queryKey: listKey });
      const list = queryClient.getQueryData<PageSummary[]>(listKey);
      if (list) {
        queryClient.setQueryData(
          listKey,
          applyPageMove(list, pageId, parentId, afterId),
        );
      }
      return { list };
    },
    onError: (_error, { projectId }, context) => {
      if (context?.list) {
        queryClient.setQueryData(pageQueryKeys.list(projectId), context.list);
      }
    },
    onSettled: (_page, _error, { pageId, projectId }) => {
      invalidatePageQueries(queryClient, { projectIds: [projectId], pageId });
    },
  });
}

export default useMovePageInTree;
