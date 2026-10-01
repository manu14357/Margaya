import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskEstimate from "@/fetchers/estimate/update-task-estimate";
import { invalidateTaskEstimates } from "./invalidate-estimate-queries";

type TaskWithEstimate = { id: string; estimatePointId?: string | null };

type BoardLike = {
  columns?: Array<{ tasks: TaskWithEstimate[] }>;
  plannedTasks?: TaskWithEstimate[];
  archivedTasks?: TaskWithEstimate[];
};

function patchTasks<T extends TaskWithEstimate>(
  tasks: T[] | undefined,
  taskId: string,
  estimatePointId: string | null,
): T[] | undefined {
  return tasks?.map((task) =>
    task.id === taskId ? { ...task, estimatePointId } : task,
  );
}

/** A copy of the board cache with one task's estimate changed. */
export function withTaskEstimate<B extends BoardLike>(
  board: B,
  taskId: string,
  estimatePointId: string | null,
): B {
  return {
    ...board,
    columns: board.columns?.map((column) => ({
      ...column,
      tasks: patchTasks(column.tasks, taskId, estimatePointId),
    })),
    plannedTasks: patchTasks(board.plannedTasks, taskId, estimatePointId),
    archivedTasks: patchTasks(board.archivedTasks, taskId, estimatePointId),
  };
}

type Variables = {
  taskId: string;
  projectId: string;
  estimatePointId: string | null;
};

type Context = { previousTask?: unknown; previousBoard?: unknown };

/** Sets or clears one task's estimate; optimistic with rollback. */
export function useUpdateTaskEstimate() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ taskId, estimatePointId }) =>
      updateTaskEstimate(taskId, estimatePointId),
    onMutate: async ({ taskId, projectId, estimatePointId }) => {
      const taskKey = ["task", taskId];
      const boardKey = ["tasks", projectId];
      await Promise.all([
        queryClient.cancelQueries({ queryKey: taskKey }),
        queryClient.cancelQueries({ queryKey: boardKey }),
      ]);
      const previousTask = queryClient.getQueryData(taskKey);
      const previousBoard = queryClient.getQueryData(boardKey);

      queryClient.setQueryData<TaskWithEstimate | undefined>(taskKey, (task) =>
        task ? { ...task, estimatePointId } : task,
      );
      queryClient.setQueryData<BoardLike | undefined>(boardKey, (board) =>
        board ? withTaskEstimate(board, taskId, estimatePointId) : board,
      );
      return { previousTask, previousBoard };
    },
    onError: (_error, { taskId, projectId }, context) => {
      queryClient.setQueryData(["task", taskId], context?.previousTask);
      queryClient.setQueryData(["tasks", projectId], context?.previousBoard);
    },
    onSettled: (_data, _error, { taskId, projectId }) => {
      invalidateTaskEstimates(queryClient, projectId, [taskId]);
    },
  });
}

export default useUpdateTaskEstimate;
