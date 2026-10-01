import { useMutation, useQueryClient } from "@tanstack/react-query";
import reorderEstimatePoints from "@/fetchers/estimate/reorder-estimate-points";
import { estimateQueryKeys } from "@/hooks/queries/estimate/estimate-query-keys";
import type { EstimateList } from "@/types/estimate";
import { storeEstimate, withPointOrder } from "./estimate-cache";
import { invalidateEstimateQueries } from "./invalidate-estimate-queries";

type Variables = { projectId: string; estimateId: string; pointIds: string[] };

/** Reorders a categories system; optimistic, rolled back on error. */
export function useReorderEstimatePoints() {
  const queryClient = useQueryClient();

  return useMutation<
    Awaited<ReturnType<typeof reorderEstimatePoints>>,
    Error,
    Variables,
    { previous?: EstimateList }
  >({
    mutationFn: ({ projectId, estimateId, pointIds }) =>
      reorderEstimatePoints(projectId, estimateId, pointIds),
    onMutate: async ({ projectId, estimateId, pointIds }) => {
      const key = estimateQueryKeys.all(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EstimateList>(key);
      queryClient.setQueryData<EstimateList>(key, (list) =>
        list
          ? {
              ...list,
              estimates: list.estimates.map((estimate) =>
                estimate.id === estimateId
                  ? withPointOrder(estimate, pointIds)
                  : estimate,
              ),
            }
          : list,
      );
      return { previous };
    },
    onError: (_error, { projectId }, context) => {
      queryClient.setQueryData(
        estimateQueryKeys.all(projectId),
        context?.previous,
      );
    },
    onSuccess: (estimate, { projectId }) => {
      storeEstimate(queryClient, projectId, estimate);
    },
    onSettled: (_data, _error, { projectId }) => {
      invalidateEstimateQueries(queryClient, projectId);
    },
  });
}

export default useReorderEstimatePoints;
