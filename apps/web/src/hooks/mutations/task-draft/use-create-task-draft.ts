import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskDraft from "@/fetchers/task-draft/create-task-draft";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import type { TaskDraftPatch } from "@/types/task-draft";

export function useCreateTaskDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      fields,
    }: {
      workspaceId: string;
      fields: TaskDraftPatch;
    }) => createTaskDraft(workspaceId, fields),
    onSuccess: (_draft, { workspaceId }) => {
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.workspace(workspaceId),
      });
    },
  });
}

export default useCreateTaskDraft;
