import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTask, { type UpdateTaskInput } from "@/fetchers/task/update-task";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: UpdateTaskInput) => updateTask(task.id, task),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["task", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.id],
      });
      // Subtask and relation rows show assignees.
      if (variables.replaceAssigneeIds) {
        queryClient.invalidateQueries({ queryKey: ["task-relations"] });
      }
      // Drag and drop between columns changes status through this hook.
      invalidatePlanningProgress(queryClient, variables.projectId);
    },
  });
}
