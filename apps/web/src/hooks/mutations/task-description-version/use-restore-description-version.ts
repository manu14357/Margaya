import { useMutation, useQueryClient } from "@tanstack/react-query";
import restoreDescriptionVersion from "@/fetchers/task-description-version/restore-description-version";
import { descriptionVersionKeys } from "@/hooks/queries/task-description-version/keys";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

/**
 * Restores a description version. The server saves it like any description
 * edit, so the same caches refresh as after a save, plus the history.
 */
export function useRestoreDescriptionVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      versionId,
    }: {
      taskId: string;
      projectId: string;
      versionId: string;
    }) => restoreDescriptionVersion(taskId, versionId),
    onSuccess: (_, { taskId, projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      queryClient.invalidateQueries({
        queryKey: descriptionVersionKeys.list(taskId),
      });
      void invalidateTaskQueries(queryClient, projectId);
    },
  });
}
