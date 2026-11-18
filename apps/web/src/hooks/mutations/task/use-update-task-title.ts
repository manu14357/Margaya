import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskTitle from "@/fetchers/task/update-task-title";
import type Task from "@/types/task";
import { boardTaskEdit } from "./board-task-edit";

export function useUpdateTaskTitle() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTaskTitle>>,
    Task
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: { title: task.title },
  }));

  return useMutation({
    mutationFn: (task: Task) => updateTaskTitle(task.id, task),
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
