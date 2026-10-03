import { useMutation, useQueryClient } from "@tanstack/react-query";
import restorePageVersion from "@/fetchers/page/restore-page-version";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = { pageId: string; projectId: string; versionId: string };

/**
 * Restores a saved version. The server first saves the current content as a
 * version, then changes the live document, which every editor receives.
 */
export function useRestorePageVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, versionId }: Variables) =>
      restorePageVersion(pageId, versionId),
    onSettled: (_page, _error, { pageId, projectId }) => {
      invalidatePageQueries(queryClient, { projectIds: [projectId], pageId });
    },
  });
}

export default useRestorePageVersion;
