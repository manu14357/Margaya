import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskTemplate from "@/fetchers/task-template/update-task-template";
import { taskTemplateQueryKeys } from "@/hooks/queries/task-template/task-template-query-keys";
import type { UpdateTaskTemplateInput } from "@/types/task-template";

export function useUpdateTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      workspaceId: string;
      projectId: string;
      id: string;
      patch: UpdateTaskTemplateInput;
    }) => updateTaskTemplate(id, patch),
    onSettled: (_saved, _error, { workspaceId, projectId }) => {
      void queryClient.invalidateQueries({
        queryKey: taskTemplateQueryKeys.list(workspaceId, projectId),
        exact: true,
      });
    },
  });
}

export default useUpdateTaskTemplate;
