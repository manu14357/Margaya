import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskMilestone from "@/fetchers/task/update-task-milestone";

type Variables = { taskId: string; projectId: string; isMilestone: boolean };
type Context = { previousTask?: unknown };

/**
 * Marks a task as a milestone or back. The switch follows at once and rolls
 * back if the request fails; the board, and so the timeline, refetches.
 */
export function useUpdateTaskMilestone() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ taskId, isMilestone }) =>
      updateTaskMilestone(taskId, isMilestone),
    onMutate: async ({ taskId, isMilestone }) => {
      const taskKey = ["task", taskId];
      await queryClient.cancelQueries({ queryKey: taskKey });
      const previousTask = queryClient.getQueryData(taskKey);
      queryClient.setQueryData<{ isMilestone?: boolean } | undefined>(
        taskKey,
        (current) => (current ? { ...current, isMilestone } : current),
      );
      return { previousTask };
    },
    onError: (_error, { taskId }, context) => {
      queryClient.setQueryData(["task", taskId], context?.previousTask);
    },
    onSettled: (_data, _error, { taskId, projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });
}
