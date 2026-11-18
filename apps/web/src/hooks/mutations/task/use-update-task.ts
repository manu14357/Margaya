import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTask, { type UpdateTaskInput } from "@/fetchers/task/update-task";
import { boardTaskEdit } from "./board-task-edit";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTask>>,
    UpdateTaskInput
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: {
      title: task.title,
      status: task.status,
      priority: task.priority,
      startDate: task.startDate || null,
      dueDate: task.dueDate || null,
      position: task.position ?? 0,
      // A deferred description is not sent, so it does not change.
      ...(task.descriptionDeferred
        ? {}
        : { description: task.description || "" }),
    },
  }));

  return useMutation({
    mutationFn: (task: UpdateTaskInput) => updateTask(task.id, task),
    meta: { refreshTaskQueries: true },
    onMutate: board.onMutate,
    onSuccess: (data, variables, context) => {
      board.onSaved(data, context);
      queryClient.invalidateQueries({ queryKey: ["task", variables.id] });
      // A full update can change the status and due date, which project
      // lists count.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.id] });
      // Subtask and relation rows show assignees.
      if (variables.replaceAssigneeIds) {
        queryClient.invalidateQueries({ queryKey: ["task-relations"] });
      }
      // A full update can change the status.
      invalidatePlanningProgress(queryClient, variables.projectId);
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}
