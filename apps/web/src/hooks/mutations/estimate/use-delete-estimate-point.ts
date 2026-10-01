import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteEstimatePoint, {
  type DeletePointOutcome,
} from "@/fetchers/estimate/delete-estimate-point";
import { storeEstimate } from "./estimate-cache";
import {
  invalidateEstimateQueries,
  invalidateEstimateRemap,
} from "./invalidate-estimate-queries";

/**
 * Deletes a value. When tasks use it, `outcome` moves them to another value
 * or clears them; without one the API answers 409 with the task count.
 */
export function useDeleteEstimatePoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
      pointId,
      outcome,
    }: {
      projectId: string;
      estimateId: string;
      pointId: string;
      outcome?: DeletePointOutcome;
    }) => deleteEstimatePoint(projectId, estimateId, pointId, outcome),
    onSuccess: (result, { projectId }) => {
      storeEstimate(queryClient, projectId, result.estimate);
      if (result.movedTaskCount + result.clearedTaskCount > 0) {
        invalidateEstimateRemap(queryClient, projectId);
      } else {
        invalidateEstimateQueries(queryClient, projectId);
      }
    },
  });
}

export default useDeleteEstimatePoint;
