import { useMutation, useQueryClient } from "@tanstack/react-query";
import removeSampleData from "@/fetchers/project-template/sample-data";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

/**
 * Moves a project's example tasks to the trash. The author's tab refreshes
 * the project (its hasSampleData flag), its task lists and the trash itself;
 * other tabs follow through the bulk-delete events.
 */
export function useRemoveSampleData({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeSampleData({ projectId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId, projectId],
      });
      void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
      void invalidateTaskQueries(queryClient, projectId);
    },
  });
}
