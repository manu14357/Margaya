import { useMemo } from "react";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { getEstimateValueMap } from "@/lib/estimate/totals";
import { useGetEstimates } from "./use-get-estimates";

/**
 * "Estimates active": the project's estimates feature is on and it has an
 * active system. Every estimate surface outside settings renders only then.
 * `pointsById` resolves a task's point to its value and position. With
 * `enabled: false` nothing is fetched and estimates read as inactive.
 */
export function useActiveEstimate({
  projectId,
  workspaceId,
  enabled = true,
}: {
  projectId: string;
  workspaceId: string;
  enabled?: boolean;
}) {
  const ready = enabled && Boolean(projectId) && Boolean(workspaceId);
  const { isEnabled, isLoading: isProjectLoading } = useProjectFeatures({
    projectId: ready ? projectId : "",
    workspaceId,
  });
  const featureEnabled = ready && isEnabled("estimates");
  const query = useGetEstimates(projectId, { enabled: featureEnabled });
  const { data } = query;

  const estimate = useMemo(() => {
    if (!featureEnabled || !data?.activeEstimateId) return null;
    return (
      data.estimates.find(
        (candidate) => candidate.id === data.activeEstimateId,
      ) ?? null
    );
  }, [featureEnabled, data]);

  const pointsById = useMemo(() => getEstimateValueMap(estimate), [estimate]);

  return {
    isActive: estimate !== null,
    featureEnabled,
    estimate,
    pointsById,
    isLoading: isProjectLoading || (featureEnabled && query.isLoading),
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

export default useActiveEstimate;
