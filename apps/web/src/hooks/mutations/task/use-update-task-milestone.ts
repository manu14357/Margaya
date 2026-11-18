import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskMilestone from "@/fetchers/task/update-task-milestone";
import { startBoardEdit } from "@/lib/board-cache";
import type { BoardEditContext } from "./board-task-edit";

type Variables = { taskId: string; projectId: string; isMilestone: boolean };
type Context = BoardEditContext & { previousTask?: unknown };

/**
 * Marks a task as a milestone or back. The switch follows at once and rolls
 * back if the request fails, on the task and on the board (the timeline).
 */
export function useUpdateTaskMilestone() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ taskId, isMilestone }) =>
      updateTaskMilestone(taskId, isMilestone),
    meta: { refreshTaskQueries: true },
    onMutate: async ({ taskId, projectId, isMilestone }) => {
      const taskKey = ["task", taskId];
      await queryClient.cancelQueries({ queryKey: taskKey });
      const previousTask = queryClient.getQueryData(taskKey);
      queryClient.setQueryData<{ isMilestone?: boolean } | undefined>(
        taskKey,
        (current) => (current ? { ...current, isMilestone } : current),
      );
      const boardEdit = startBoardEdit(queryClient, projectId, taskId, {
        isMilestone,
      });
      return { previousTask, boardEdit };
    },
    onSuccess: (data, _variables, context) => {
      context?.boardEdit?.saved(data);
    },
    onError: (_error, { taskId }, context) => {
      queryClient.setQueryData(["task", taskId], context?.previousTask);
      context?.boardEdit?.failed();
    },
    onSettled: (_data, _error, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}
