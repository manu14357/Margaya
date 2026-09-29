import { useMutation, useQueryClient } from "@tanstack/react-query";
import setTaskCycle from "@/fetchers/cycle/set-task-cycle";
import { invalidateCycleMembership } from "./invalidate-cycle-queries";

type TaskWithCycle = { id: string; cycleId?: string | null };

type BoardLike = {
  columns?: Array<{ tasks: TaskWithCycle[] }>;
  plannedTasks?: TaskWithCycle[];
  archivedTasks?: TaskWithCycle[];
};

function patchTasks<T extends TaskWithCycle>(
  tasks: T[] | undefined,
  taskId: string,
  cycleId: string | null,
): T[] | undefined {
  return tasks?.map((task) =>
    task.id === taskId ? { ...task, cycleId } : task,
  );
}

/** A copy of the board cache with one task's cycle changed. */
export function withTaskCycle<B extends BoardLike>(
  board: B,
  taskId: string,
  cycleId: string | null,
): B {
  return {
    ...board,
    columns: board.columns?.map((column) => ({
      ...column,
      tasks: patchTasks(column.tasks, taskId, cycleId),
    })),
    plannedTasks: patchTasks(board.plannedTasks, taskId, cycleId),
    archivedTasks: patchTasks(board.archivedTasks, taskId, cycleId),
  };
}

type Variables = { taskId: string; projectId: string; cycleId: string | null };

type Context = { previousTask?: unknown; previousBoard?: unknown };

/** Moves one task into a cycle, or out with null; optimistic with rollback. */
export function useSetTaskCycle() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ taskId, cycleId }) => setTaskCycle(taskId, cycleId),
    onMutate: async ({ taskId, projectId, cycleId }) => {
      const taskKey = ["task", taskId];
      const boardKey = ["tasks", projectId];
      await Promise.all([
        queryClient.cancelQueries({ queryKey: taskKey }),
        queryClient.cancelQueries({ queryKey: boardKey }),
      ]);
      const previousTask = queryClient.getQueryData(taskKey);
      const previousBoard = queryClient.getQueryData(boardKey);

      queryClient.setQueryData<TaskWithCycle | undefined>(taskKey, (task) =>
        task ? { ...task, cycleId } : task,
      );
      queryClient.setQueryData<BoardLike | undefined>(boardKey, (board) =>
        board ? withTaskCycle(board, taskId, cycleId) : board,
      );
      return { previousTask, previousBoard };
    },
    onError: (_error, { taskId, projectId }, context) => {
      queryClient.setQueryData(["task", taskId], context?.previousTask);
      queryClient.setQueryData(["tasks", projectId], context?.previousBoard);
    },
    onSettled: (_data, _error, { taskId, projectId }) => {
      invalidateCycleMembership(queryClient, projectId, [taskId]);
    },
  });
}

export default useSetTaskCycle;
