import { useMutation, useQueryClient } from "@tanstack/react-query";
import deletePage from "@/fetchers/page/delete-page";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string };

/** Moves an archived page to the trash; its sub-pages become top-level pages. */
export function useDeletePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId }: Variables) => deletePage(pageId),
    onSuccess: (_deleted, { pageId }) => {
      queryClient.removeQueries({ queryKey: pageQueryKeys.detail(pageId) });
    },
    onSettled: (_deleted, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
      invalidatePageQueries(queryClient, {
        projectIds: [projectId],
        entities: true,
      });
    },
  });
}

export default useDeletePage;
