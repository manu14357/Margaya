import { useQuery } from "@tanstack/react-query";
import getCycles from "@/fetchers/cycle/get-cycles";
import type { CycleListView } from "@/types/cycle";
import { cycleQueryKeys } from "./cycle-query-keys";

export function useGetCycles(
  projectId: string,
  view: CycleListView = "all",
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: cycleQueryKeys.list(projectId, view),
    queryFn: () => getCycles(projectId, view),
    enabled: Boolean(projectId) && enabled,
  });
}

export default useGetCycles;
