import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskDraft from "@/fetchers/task-draft/delete-task-draft";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import {
  removeDraftFromCache,
  restoreDraftCache,
} from "./remove-draft-from-cache";

/** Deletes a draft; it leaves the lists at once and comes back on error. */
export function useDeleteTaskDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; workspaceId: string }) =>
      deleteTaskDraft(id),
    onMutate: async ({ id, workspaceId }) => {
      await queryClient.cancelQueries({
        queryKey: taskDraftQueryKeys.workspace(workspaceId),
      });
      return { snapshot: removeDraftFromCache(queryClient, workspaceId, id) };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreDraftCache(queryClient, context.snapshot);
    },
    onSettled: (_result, _error, { id, workspaceId }) => {
      queryClient.removeQueries({
        queryKey: taskDraftQueryKeys.detail(workspaceId, id),
      });
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.workspace(workspaceId),
      });
    },
  });
}

export default useDeleteTaskDraft;
