import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateEstimate from "@/fetchers/estimate/update-estimate";
import { invalidateEstimateQueries } from "./invalidate-estimate-queries";

/** Renames a system; its type never changes. */
export function useUpdateEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      estimateId,
      name,
    }: {
      projectId: string;
      estimateId: string;
      name: string;
    }) => updateEstimate(projectId, estimateId, name),
    onSuccess: (_estimate, { projectId }) => {
      invalidateEstimateQueries(queryClient, projectId);
    },
  });
}

export default useUpdateEstimate;
