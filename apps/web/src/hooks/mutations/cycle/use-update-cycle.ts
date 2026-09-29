import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateCycle, {
  type UpdateCycleRequest,
} from "@/fetchers/cycle/update-cycle";
import { invalidateCycleQueries } from "./invalidate-cycle-queries";

export function useUpdateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cycleId,
      json,
    }: {
      cycleId: string;
      projectId: string;
      json: UpdateCycleRequest;
    }) => updateCycle(cycleId, json),
    onSuccess: (_cycle, { projectId }) => {
      invalidateCycleQueries(queryClient, projectId, { favorites: true });
    },
  });
}

export default useUpdateCycle;
