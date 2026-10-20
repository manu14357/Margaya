import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type Task from "@/types/task";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

/** What a status change touches: the task, its board, counts and progress. */
export function invalidateAfterStatusChange(
  queryClient: QueryClient,
  task: Pick<Task, "id" | "projectId">,
) {
  queryClient.invalidateQueries({ queryKey: ["task", task.id] });
  queryClient.invalidateQueries({ queryKey: ["tasks", task.projectId] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  queryClient.invalidateQueries({ queryKey: ["projects"] });
  queryClient.invalidateQueries({ queryKey: ["activities", task.id] });
  queryClient.invalidateQueries({ queryKey: ["task-relations"] });
  invalidatePlanningProgress(queryClient, task.projectId);
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (task: Task) => updateTaskStatus(task.id, task),
    onSuccess: (_, variables) =>
      invalidateAfterStatusChange(queryClient, variables),
  });
}
