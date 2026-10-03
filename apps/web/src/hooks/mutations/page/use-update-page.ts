import { useMutation, useQueryClient } from "@tanstack/react-query";
import updatePage, {
  type UpdatePageRequest,
} from "@/fetchers/page/update-page";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import type { Page, PageSummary } from "@/types/page";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = {
  pageId: string;
  projectId: string;
  json: UpdatePageRequest;
};

type Context = { detail?: Page; list?: PageSummary[] };

/**
 * Saves the title, logo or full width. The change shows at once in the page
 * and the list, and rolls back if the server refuses it.
 */
export function useUpdatePage() {
  const queryClient = useQueryClient();

  return useMutation<Page, Error, Variables, Context>({
    mutationFn: ({ pageId, json }) => updatePage(pageId, json),
    onMutate: async ({ pageId, projectId, json }) => {
      const detailKey = pageQueryKeys.detail(pageId);
      const listKey = pageQueryKeys.list(projectId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
        queryClient.cancelQueries({ queryKey: listKey }),
      ]);
      const detail = queryClient.getQueryData<Page>(detailKey);
      const list = queryClient.getQueryData<PageSummary[]>(listKey);
      const patch = Object.fromEntries(
        Object.entries(json).filter(([, value]) => value !== undefined),
      ) as Partial<PageSummary>;

      queryClient.setQueryData<Page>(detailKey, (page) =>
        page ? { ...page, ...patch } : page,
      );
      queryClient.setQueryData<PageSummary[]>(listKey, (pages) =>
        pages?.map((page) =>
          page.id === pageId ? { ...page, ...patch } : page,
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
    onSuccess: (page) => {
      queryClient.setQueryData<Page>(pageQueryKeys.detail(page.id), page);
    },
    onSettled: (_page, _error, { pageId, projectId, json }) => {
      invalidatePageQueries(queryClient, {
        projectIds: [projectId],
        entities: json.title !== undefined || json.logoKind !== undefined,
      });
      // The detail was just written from the response; refresh it only when
      // the save failed.
      if (_error) {
        queryClient.invalidateQueries({
          queryKey: pageQueryKeys.detail(pageId),
          exact: true,
        });
      }
    },
  });
}

export default useUpdatePage;
