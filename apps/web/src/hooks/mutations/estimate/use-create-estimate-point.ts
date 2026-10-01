import { useMutation, useQueryClient } from "@tanstack/react-query";
import createEstimatePoint from "@/fetchers/estimate/create-estimate-point";
import { storeEstimate } from "./estimate-cache";
import { invalidateEstimateQueries } from "./invalidate-estimate-queries";

/** Adds a value; points and time slot in by value, categories go last. */
export function useCreateEstimatePoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
      value,
    }: {
      projectId: string;
      estimateId: string;
      value: string;
    }) => createEstimatePoint(projectId, estimateId, { value }),
    onSuccess: (estimate, { projectId }) => {
      storeEstimate(queryClient, projectId, estimate);
      invalidateEstimateQueries(queryClient, projectId);
    },
  });
}

export default useCreateEstimatePoint;
