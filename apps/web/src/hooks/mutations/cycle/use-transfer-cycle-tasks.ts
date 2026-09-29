import { useMutation, useQueryClient } from "@tanstack/react-query";
import transferCycleTasks from "@/fetchers/cycle/transfer-cycle-tasks";
import { invalidateCycleMembership } from "./invalidate-cycle-queries";

export function useTransferCycleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cycleId,
      targetCycleId,
    }: {
      cycleId: string;
      projectId: string;
      targetCycleId: string;
    }) => transferCycleTasks(cycleId, targetCycleId),
    onSuccess: (result, { projectId }) => {
      invalidateCycleMembership(queryClient, projectId, result.movedTaskIds);
    },
  });
}

export default useTransferCycleTasks;
