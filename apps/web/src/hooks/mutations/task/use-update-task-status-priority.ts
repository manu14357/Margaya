import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskPriority from "@/fetchers/task/update-task-priority";
import type Task from "@/types/task";
import { boardTaskEdit } from "./board-task-edit";

export function useUpdateTaskPriority() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTaskPriority>>,
    Task
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: { priority: task.priority },
  }));

  return useMutation({
    mutationFn: (task: Task) => updateTaskPriority(task.id, task),
    meta: { refreshTaskQueries: true },
    onMutate: board.onMutate,
    onSuccess: (data, variables, context) => {
      board.onSaved(data, context);
      queryClient.invalidateQueries({ queryKey: ["task", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.id] });
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}
