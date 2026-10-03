import { useMutation, useQueryClient } from "@tanstack/react-query";
import movePageToProject from "@/fetchers/page/move-page-to-project";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = {
  pageId: string;
  /** The project the page leaves. */
  projectId: string;
  targetProjectId: string;
};

/** Moves a page and its sub-pages to another project of the workspace. */
export function useMovePageToProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, targetProjectId }: Variables) =>
      movePageToProject(pageId, targetProjectId),
    onSettled: (_page, _error, { projectId, targetProjectId }) => {
      invalidatePageQueries(queryClient, {
        projectIds: [projectId, targetProjectId],
        allPages: true,
        entities: true,
      });
    },
  });
}

export default useMovePageToProject;
