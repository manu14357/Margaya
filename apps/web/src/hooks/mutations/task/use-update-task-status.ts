import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import { scheduleBoardRefresh } from "@/lib/board-cache";
import type Task from "@/types/task";
import { boardTaskEdit } from "./board-task-edit";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

/**
 * What a status change touches: the task, its board, project counts,
 * relation rows (they show status) and planning progress. Notifications
 * reach this tab through the user socket.
 */
export function invalidateAfterStatusChange(
  queryClient: QueryClient,
  task: Pick<Task, "id" | "projectId">,
) {
  queryClient.invalidateQueries({ queryKey: ["task", task.id] });
  scheduleBoardRefresh(queryClient, task.projectId);
  queryClient.invalidateQueries({ queryKey: ["projects"] });
  queryClient.invalidateQueries({ queryKey: ["activities", task.id] });
  queryClient.invalidateQueries({ queryKey: ["task-relations"] });
  invalidatePlanningProgress(queryClient, task.projectId);
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<
    Awaited<ReturnType<typeof updateTaskStatus>>,
    Task
  >(queryClient, (task) => ({
    projectId: task.projectId,
    taskId: task.id,
    patch: { status: task.status },
  }));

  return useMutation({
    mutationFn: (task: Task) => updateTaskStatus(task.id, task),
    meta: { refreshTaskQueries: true },
    onMutate: board.onMutate,
    onSuccess: (data, variables, context) => {
      board.onSaved(data, context);
      invalidateAfterStatusChange(queryClient, variables);
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}
