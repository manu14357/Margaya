import { useMutation, useQueryClient } from "@tanstack/react-query";
import addCycleTasks from "@/fetchers/cycle/add-cycle-tasks";
import {
  type CycleTaskChangeSummary,
  changedTaskIds,
  chunkIds,
  mergeTaskChanges,
} from "@/lib/cycle/batch";
import { invalidateCycleMembership } from "./invalidate-cycle-queries";

/** Adds tasks to a cycle in batches of 200; tasks in another cycle move. */
export function useAddCycleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cycleId,
      taskIds,
    }: {
      cycleId: string;
      projectId: string;
      taskIds: string[];
    }) => {
      const changes: CycleTaskChangeSummary[] = [];
      for (const batch of chunkIds(taskIds)) {
        changes.push(await addCycleTasks(cycleId, batch));
      }
      return mergeTaskChanges(changes);
    },
    onSettled: (change, _error, { projectId, taskIds }) => {
      invalidateCycleMembership(
        queryClient,
        projectId,
        change ? changedTaskIds(change) : taskIds,
      );
    },
  });
}

export default useAddCycleTasks;
