import { useMutation, useQueryClient } from "@tanstack/react-query";
import archivePage from "@/fetchers/page/archive-page";
import unarchivePage from "@/fetchers/page/unarchive-page";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string; archived: boolean };

/**
 * Archives a page with its sub-pages, or restores them. Not optimistic: the
 * server cascades, so every page query refreshes afterwards.
 */
export function useSetPageArchived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, archived }: Variables) =>
      archived ? archivePage(pageId) : unarchivePage(pageId),
    onSettled: (_page, _error, { projectId }) => {
      invalidatePageQueries(queryClient, {
        projectIds: [projectId],
        allPages: true,
        entities: true,
      });
    },
  });
}

export default useSetPageArchived;
