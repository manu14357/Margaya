import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskTemplate from "@/fetchers/task-template/delete-task-template";
import { taskTemplateQueryKeys } from "@/hooks/queries/task-template/task-template-query-keys";
import type { TaskTemplate } from "@/types/task-template";

/** Deletes a template; it leaves the list at once, and returns on error. */
export function useDeleteTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
    }: {
      workspaceId: string;
      projectId: string;
      id: string;
    }) => deleteTaskTemplate(id),
    onMutate: async ({ workspaceId, projectId, id }) => {
      const key = taskTemplateQueryKeys.list(workspaceId, projectId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<TaskTemplate[]>(key);
      if (previous) {
        queryClient.setQueryData(
          key,
          previous.filter((template) => template.id !== id),
        );
      }
      return { previous };
    },
    onError: (_error, { workspaceId, projectId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          taskTemplateQueryKeys.list(workspaceId, projectId),
          context.previous,
        );
      }
    },
    onSettled: (_deleted, _error, { workspaceId, projectId }) => {
      void queryClient.invalidateQueries({
        queryKey: taskTemplateQueryKeys.list(workspaceId, projectId),
        exact: true,
      });
    },
  });
}

export default useDeleteTaskTemplate;
