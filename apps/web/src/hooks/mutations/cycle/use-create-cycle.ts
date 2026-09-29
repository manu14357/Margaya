import { useMutation, useQueryClient } from "@tanstack/react-query";
import createCycle, {
  type CreateCycleRequest,
} from "@/fetchers/cycle/create-cycle";
import { invalidateCycleQueries } from "./invalidate-cycle-queries";

export function useCreateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      ...json
    }: CreateCycleRequest & { projectId: string }) =>
      createCycle(projectId, json),
    onSuccess: (_cycle, { projectId }) => {
      invalidateCycleQueries(queryClient, projectId);
    },
  });
}

export default useCreateCycle;
