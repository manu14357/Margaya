import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskDescription from "@/fetchers/task/update-task-description";
import { descriptionVersionKeys } from "@/hooks/queries/task-description-version/keys";
import type Task from "@/types/task";
import { boardTaskEdit } from "./board-task-edit";

export function useUpdateTaskDescription() {
  const queryClient = useQueryClient();
  // Board cards count the description's checklist items.
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTaskDescription>>,
    Task
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: { description: task.description, descriptionDeferred: false },
  }));

  return useMutation({
    mutationFn: (task: Task) => updateTaskDescription(task.id, task),
    meta: { refreshTaskQueries: true },
    onMutate: board.onMutate,
    onSuccess: (data, variables, context) => {
      board.onSaved(data, context);
      queryClient.invalidateQueries({ queryKey: ["task", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.id] });
      queryClient.invalidateQueries({
        queryKey: descriptionVersionKeys.list(variables.id),
      });
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}
