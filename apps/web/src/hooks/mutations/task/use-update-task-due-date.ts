import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskDueDate from "@/fetchers/task/update-task-due-date";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import type Task from "@/types/task";
import { boardTaskEdit } from "./board-task-edit";

export function useUpdateTaskDueDate() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTaskDueDate>>,
    Task
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: { dueDate: task.dueDate || null },
  }));

  return useMutation({
    mutationFn: (task: Task) => updateTaskDueDate(task.id, task),
    meta: { refreshTaskQueries: true },
    onMutate: board.onMutate,
    onSuccess: (data, variables, context) => {
      board.onSaved(data, context);
      queryClient.invalidateQueries({ queryKey: ["task", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.id] });
      // Project lists show the earliest open due date.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Risk radars flag overdue work.
      invalidateDeliveryQueries(queryClient, variables.projectId);
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}
