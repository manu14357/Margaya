import { useQuery } from "@tanstack/react-query";
import getCycleProgress from "@/fetchers/cycle/get-cycle-progress";
import { cycleQueryKeys } from "./cycle-query-keys";

export function useGetCycleProgress(
  projectId: string,
  cycleId: string | undefined,
) {
  return useQuery({
    queryKey: cycleQueryKeys.progress(projectId, cycleId ?? ""),
    queryFn: () => getCycleProgress(cycleId ?? ""),
    enabled: Boolean(projectId && cycleId),
  });
}

export default useGetCycleProgress;
