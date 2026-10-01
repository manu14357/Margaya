import { useQuery } from "@tanstack/react-query";
import getEstimates from "@/fetchers/estimate/get-estimates";
import { estimateQueryKeys } from "./estimate-query-keys";

/**
 * The project's estimate systems. Every estimate route answers 403 while the
 * feature is off, so callers pass `enabled: false` until it is on.
 */
export function useGetEstimates(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: estimateQueryKeys.all(projectId),
    queryFn: () => getEstimates(projectId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60_000,
  });
}

export default useGetEstimates;
