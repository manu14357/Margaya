import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateEstimatePoint from "@/fetchers/estimate/update-estimate-point";
import { storeEstimate } from "./estimate-cache";
import { invalidateEstimateQueries } from "./invalidate-estimate-queries";

/** Changes a value's text; tasks keep the value and show the new text. */
export function useUpdateEstimatePoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
      pointId,
      value,
    }: {
      projectId: string;
      estimateId: string;
      pointId: string;
      value: string;
    }) => updateEstimatePoint(projectId, estimateId, pointId, value),
    onSuccess: (estimate, { projectId }) => {
      storeEstimate(queryClient, projectId, estimate);
      invalidateEstimateQueries(queryClient, projectId);
    },
  });
}

export default useUpdateEstimatePoint;
