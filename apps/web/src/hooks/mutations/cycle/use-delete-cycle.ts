import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteCycle from "@/fetchers/cycle/delete-cycle";
import {
  invalidateCycleMembership,
  invalidateCycleQueries,
} from "./invalidate-cycle-queries";

export function useDeleteCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ cycleId }: { cycleId: string; projectId: string }) =>
      deleteCycle(cycleId),
    onSuccess: (result, { projectId }) => {
      invalidateCycleMembership(queryClient, projectId, result.removedTaskIds);
      // The API removes the cycle's favorites and recent visits.
      invalidateCycleQueries(queryClient, projectId, { favorites: true });
      queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
    },
  });
}

export default useDeleteCycle;
