import { useMutation, useQueryClient } from "@tanstack/react-query";
import createEstimate, {
  type CreateEstimateRequest,
} from "@/fetchers/estimate/create-estimate";
import { invalidateEstimateQueries } from "./invalidate-estimate-queries";

export function useCreateEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      ...json
    }: CreateEstimateRequest & { projectId: string }) =>
      createEstimate(projectId, json),
    onSuccess: (_estimate, { projectId }) => {
      invalidateEstimateQueries(queryClient, projectId);
    },
  });
}

export default useCreateEstimate;
