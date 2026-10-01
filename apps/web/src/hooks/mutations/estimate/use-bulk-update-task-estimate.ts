import { useMutation, useQueryClient } from "@tanstack/react-query";
import bulkUpdateTaskEstimate from "@/fetchers/estimate/bulk-update-task-estimate";
import { invalidateTaskEstimates } from "./invalidate-estimate-queries";

/** Sets or clears the estimate of many tasks of one project. */
export function useBulkUpdateTaskEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskIds,
      estimatePointId,
    }: {
      projectId: string;
      taskIds: string[];
      estimatePointId: string | null;
    }) => bulkUpdateTaskEstimate(taskIds, estimatePointId),
    onSettled: (_data, _error, { projectId, taskIds }) => {
      invalidateTaskEstimates(queryClient, projectId, taskIds);
    },
  });
}

export default useBulkUpdateTaskEstimate;
