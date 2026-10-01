import { useMutation, useQueryClient } from "@tanstack/react-query";
import activateEstimate, {
  type EstimatePointMapping,
} from "@/fetchers/estimate/activate-estimate";
import {
  invalidateEstimateQueries,
  invalidateEstimateRemap,
} from "./invalidate-estimate-queries";

/** Switches the project to a system, moving tasks as mapped. */
export function useActivateEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
      mapping,
    }: {
      projectId: string;
      estimateId: string;
      mapping: EstimatePointMapping[];
    }) => activateEstimate(projectId, estimateId, mapping),
    onSuccess: (result, { projectId }) => {
      if (result.remappedTaskCount + result.clearedTaskCount > 0) {
        invalidateEstimateRemap(queryClient, projectId);
      } else {
        invalidateEstimateQueries(queryClient, projectId);
      }
    },
  });
}

export default useActivateEstimate;
