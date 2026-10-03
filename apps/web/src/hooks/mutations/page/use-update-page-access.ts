import { useMutation, useQueryClient } from "@tanstack/react-query";
import updatePageAccess from "@/fetchers/page/update-page-access";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import type { Page, PageAccess } from "@/types/page";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string; access: PageAccess };
type Context = { detail?: Page };

/**
 * Makes a page private (with its sub-pages) or public. The page itself
 * shows the new access at once; everything else refreshes after the server
 * applied the cascade.
 */
export function useUpdatePageAccess() {
  const queryClient = useQueryClient();

  return useMutation<Page, Error, Variables, Context>({
    mutationFn: ({ pageId, access }) => updatePageAccess(pageId, access),
    onMutate: async ({ pageId, access }) => {
      const detailKey = pageQueryKeys.detail(pageId);
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      const detail = queryClient.getQueryData<Page>(detailKey);
      queryClient.setQueryData<Page>(detailKey, (page) =>
        page ? { ...page, access } : page,
      );
      return { detail };
    },
    onError: (_error, { pageId }, context) => {
      if (context?.detail) {
        queryClient.setQueryData(pageQueryKeys.detail(pageId), context.detail);
      }
    },
    onSettled: (_page, _error, { projectId }) => {
      invalidatePageQueries(queryClient, {
        projectIds: [projectId],
        allPages: true,
        entities: true,
      });
    },
  });
}

export default useUpdatePageAccess;
