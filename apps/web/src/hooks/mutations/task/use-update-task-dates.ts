import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskDates from "@/fetchers/task/update-task-dates";
import type { TaskDates } from "@/lib/schedule-dates";
import type Task from "@/types/task";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

type DatedTask = { id: string } & TaskDates;

type BoardLike = {
  columns?: Array<{ tasks: DatedTask[] }>;
  plannedTasks?: DatedTask[];
  archivedTasks?: DatedTask[];
};

function patchTasks<T extends DatedTask>(
  tasks: T[] | undefined,
  taskId: string,
  dates: TaskDates,
): T[] | undefined {
  return tasks?.map((task) =>
    task.id === taskId ? { ...task, ...dates } : task,
  );
}

/** A copy of the board cache with one task's start and due dates replaced. */
export function withTaskDates<B extends BoardLike>(
  board: B,
  taskId: string,
  dates: TaskDates,
): B {
  return {
    ...board,
    columns: board.columns?.map((column) => ({
      ...column,
      tasks: patchTasks(column.tasks, taskId, dates),
    })),
    plannedTasks: patchTasks(board.plannedTasks, taskId, dates),
    archivedTasks: patchTasks(board.archivedTasks, taskId, dates),
  };
}

/**
 * The request body for a move. A null date is one the task doesn't have on
 * this board, so it is left out rather than sent as a clear: someone may have
 * set it since the board loaded.
 */
export function datesToSend({ startDate, dueDate }: TaskDates) {
  return { startDate: startDate ?? undefined, dueDate: dueDate ?? undefined };
}

type Variables = { task: Task } & TaskDates;
type Context = { previousTask?: unknown; previousBoard?: unknown };

/**
 * Sets a task's start and due dates together (calendar drops, timeline
 * scheduling) in one atomic request that sends only the dates: the rest of
 * `task` is this board's copy, and writing it back would undo anyone's newer
 * edit. The board and the task move at once and roll back if the request
 * fails; the server copy is refetched either way.
 */
export function useUpdateTaskDates() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ task, startDate, dueDate }) =>
      updateTaskDates(task.id, datesToSend({ startDate, dueDate })),
    onMutate: async ({ task, startDate, dueDate }) => {
      const taskKey = ["task", task.id];
      const boardKey = ["tasks", task.projectId];
      await Promise.all([
        queryClient.cancelQueries({ queryKey: taskKey }),
        queryClient.cancelQueries({ queryKey: boardKey }),
      ]);
      const previousTask = queryClient.getQueryData(taskKey);
      const previousBoard = queryClient.getQueryData(boardKey);
      const dates = { startDate, dueDate };

      queryClient.setQueryData<DatedTask | undefined>(taskKey, (current) =>
        current ? { ...current, ...dates } : current,
      );
      queryClient.setQueryData<BoardLike | undefined>(boardKey, (board) =>
        board ? withTaskDates(board, task.id, dates) : board,
      );
      return { previousTask, previousBoard };
    },
    onError: (_error, { task }, context) => {
      queryClient.setQueryData(["task", task.id], context?.previousTask);
      queryClient.setQueryData(
        ["tasks", task.projectId],
        context?.previousBoard,
      );
    },
    onSettled: (_data, _error, { task }) => {
      queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      queryClient.invalidateQueries({ queryKey: ["tasks", task.projectId] });
      queryClient.invalidateQueries({ queryKey: ["activities", task.id] });
      invalidatePlanningProgress(queryClient, task.projectId);
    },
  });
}
