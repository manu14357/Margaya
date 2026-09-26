import { useMutation, useQueryClient } from "@tanstack/react-query";
import archiveProject from "@/fetchers/project/archive-project";
import unarchiveProject from "@/fetchers/project/unarchive-project";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";

/**
 * Archives (`archive: true`) or restores a project. Project lists, the
 * archives and favorites (which hide archived projects) refresh.
 */
export function useArchiveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      archive,
    }: {
      projectId: string;
      workspaceId: string;
      archive: boolean;
    }) => (archive ? archiveProject(projectId) : unarchiveProject(projectId)),
    onSuccess: (_project, { workspaceId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: archiveQueryKeys.all() });
      void queryClient.invalidateQueries({
        queryKey: ["favorites", workspaceId],
      });
    },
  });
}

export default useArchiveProject;
