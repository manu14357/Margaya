import { useMutation, useQueryClient } from "@tanstack/react-query";
import applyTaskTemplate from "@/fetchers/task-template/apply-task-template";
import { invalidateTaskQueries } from "@/lib/task-query/cache";
import type { ApplyTaskTemplateInput } from "@/types/task-template";

/**
 * Creates a task from a template. Refreshes what a regular create does,
 * plus the relation caches its sub-tasks touch and the workspace labels the
 * server copied onto the task.
 */
export function useApplyTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      templateId,
      input,
    }: {
      templateId: string;
      projectId: string;
      workspaceId: string;
      input: ApplyTaskTemplateInput;
    }) => applyTaskTemplate(templateId, input),
    onSuccess: (task, { projectId, workspaceId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      void queryClient.invalidateQueries({
        queryKey: ["custom-field-values", projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ["labels", workspaceId] });
      void invalidateTaskQueries(queryClient, projectId);
      if (task.subtaskIds.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["task-relations", task.id],
        });
        void queryClient.invalidateQueries({
          queryKey: ["task-relations", "project"],
        });
      }
    },
  });
}

export default useApplyTaskTemplate;
