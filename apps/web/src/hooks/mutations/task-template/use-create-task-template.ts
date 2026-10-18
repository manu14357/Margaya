import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskTemplate from "@/fetchers/task-template/create-task-template";
import { taskTemplateQueryKeys } from "@/hooks/queries/task-template/task-template-query-keys";
import type { CreateTaskTemplateInput } from "@/types/task-template";

export function useCreateTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      input,
    }: {
      workspaceId: string;
      input: CreateTaskTemplateInput;
    }) => createTaskTemplate(input),
    onSettled: (_created, _error, { workspaceId, input }) => {
      void queryClient.invalidateQueries({
        queryKey: taskTemplateQueryKeys.list(workspaceId, input.projectId),
        exact: true,
      });
    },
  });
}

export default useCreateTaskTemplate;
