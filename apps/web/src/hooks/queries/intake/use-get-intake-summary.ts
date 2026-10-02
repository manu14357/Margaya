import { useQuery } from "@tanstack/react-query";
import getIntakeSummary from "@/fetchers/intake/get-intake-summary";
import { intakeQueryKeys } from "./intake-query-keys";

export function useGetIntakeSummary(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: intakeQueryKeys.summary(projectId),
    queryFn: () => getIntakeSummary(projectId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30_000,
  });
}

export default useGetIntakeSummary;
