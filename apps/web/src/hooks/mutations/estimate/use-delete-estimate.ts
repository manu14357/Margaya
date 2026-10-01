import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteEstimate from "@/fetchers/estimate/delete-estimate";
import {
  invalidateEstimateQueries,
  invalidateEstimateRemap,
} from "./invalidate-estimate-queries";

/** Deletes a system; the active one leaves its tasks without an estimate. */
export function useDeleteEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
    }: {
      projectId: string;
      estimateId: string;
    }) => deleteEstimate(projectId, estimateId),
    onSuccess: (result, { projectId }) => {
      if (result.clearedTaskCount > 0) {
        invalidateEstimateRemap(queryClient, projectId);
      } else {
        invalidateEstimateQueries(queryClient, projectId);
      }
    },
  });
}

export default useDeleteEstimate;
