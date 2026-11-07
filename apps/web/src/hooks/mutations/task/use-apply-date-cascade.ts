import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskDates from "@/fetchers/task/update-task-dates";
import type { TaskDates } from "@/lib/schedule-dates";
import type Task from "@/types/task";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";
import { datesToSend, withTaskDates } from "./use-update-task-dates";

export type DateCascadeMove = { task: Task } & TaskDates;

type BoardLike = Parameters<typeof withTaskDates>[0];

/**
 * Saves the moves someone confirmed in the date cascade preview. They go one
 * at a time, and one failing doesn't stop the rest: the board and the task
 * are refetched afterwards either way, so what failed shows where it was.
 *
 * Each task's dates move in one atomic request that sends only the dates:
 * the rest of `task` is this browser's copy, and a full update would write it
 * back over anyone's newer edit.
 */
export function useApplyDateCascade(projectId: string) {
  const queryClient = useQueryClient();
  const boardKey = ["tasks", projectId];

  return useMutation({
    mutationFn: async (moves: DateCascadeMove[]) => {
      let moved = 0;
      for (const { task, startDate, dueDate } of moves) {
        try {
          await updateTaskDates(task.id, datesToSend({ startDate, dueDate }));
          moved += 1;
        } catch {
          // Counted below; the refetch puts this task back.
        }
      }
      return { moved, failed: moves.length - moved };
    },
    onMutate: async (moves) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      queryClient.setQueryData<BoardLike | undefined>(boardKey, (board) =>
        board
          ? moves.reduce(
              (current, { task, startDate, dueDate }) =>
                withTaskDates(current, task.id, { startDate, dueDate }),
              board,
            )
          : board,
      );
    },
    onSettled: (_data, _error, moves) => {
      queryClient.invalidateQueries({ queryKey: boardKey });
      for (const { task } of moves) {
        queryClient.invalidateQueries({ queryKey: ["task", task.id] });
        queryClient.invalidateQueries({ queryKey: ["activities", task.id] });
      }
      invalidatePlanningProgress(queryClient, projectId);
    },
  });
}
