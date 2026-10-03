import { useMutation, useQueryClient } from "@tanstack/react-query";
import duplicatePage from "@/fetchers/page/duplicate-page";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string };

/** Copies a page (not its sub-pages) right after it, owned by the caller. */
export function useDuplicatePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId }: Variables) => duplicatePage(pageId),
    onSuccess: (page) => {
      queryClient.setQueryData(pageQueryKeys.detail(page.id), page);
    },
    onSettled: (_page, _error, { projectId }) => {
      invalidatePageQueries(queryClient, { projectIds: [projectId] });
    },
  });
}

export default useDuplicatePage;
