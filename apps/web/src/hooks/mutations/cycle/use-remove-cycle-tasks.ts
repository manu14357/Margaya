import { useMutation, useQueryClient } from "@tanstack/react-query";
import removeCycleTasks from "@/fetchers/cycle/remove-cycle-tasks";
import {
  type CycleTaskChangeSummary,
  changedTaskIds,
  chunkIds,
  mergeTaskChanges,
} from "@/lib/cycle/batch";
import { invalidateCycleMembership } from "./invalidate-cycle-queries";

/**
 * Takes tasks out of their cycles. `taskIdsByCycle` maps each cycle to the
 * selected tasks in it; each cycle gets its own calls, in batches of 200.
 */
export function useRemoveCycleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskIdsByCycle,
    }: {
      projectId: string;
      taskIdsByCycle: Map<string, string[]>;
    }) => {
      const changes: CycleTaskChangeSummary[] = [];
      for (const [cycleId, taskIds] of taskIdsByCycle) {
        for (const batch of chunkIds(taskIds)) {
          changes.push(await removeCycleTasks(cycleId, batch));
        }
      }
      return mergeTaskChanges(changes);
    },
    onSettled: (change, _error, { projectId, taskIdsByCycle }) => {
      invalidateCycleMembership(
        queryClient,
        projectId,
        change ? changedTaskIds(change) : [...taskIdsByCycle.values()].flat(),
      );
    },
  });
}

export default useRemoveCycleTasks;
