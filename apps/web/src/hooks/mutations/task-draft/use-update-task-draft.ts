import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskDraft from "@/fetchers/task-draft/update-task-draft";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import type { TaskDraftPatch } from "@/types/task-draft";

export function useUpdateTaskDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: string;
      workspaceId: string;
      fields: TaskDraftPatch;
    }) => updateTaskDraft(id, fields),
    onSuccess: (draft, { id, workspaceId }) => {
      queryClient.setQueryData(
        taskDraftQueryKeys.detail(workspaceId, id),
        draft,
      );
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.workspace(workspaceId),
      });
    },
  });
}

export default useUpdateTaskDraft;
