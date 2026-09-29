import { useQuery } from "@tanstack/react-query";
import getCycle from "@/fetchers/cycle/get-cycle";
import { HttpError } from "@/lib/http-error";
import { cycleQueryKeys } from "./cycle-query-keys";

function isClientError(error: unknown) {
  return (
    error instanceof HttpError && error.status >= 400 && error.status < 500
  );
}

export function useGetCycle(projectId: string, cycleId: string) {
  return useQuery({
    queryKey: cycleQueryKeys.detail(projectId, cycleId),
    queryFn: () => getCycle(cycleId),
    enabled: Boolean(projectId && cycleId),
    // A deleted or foreign cycle stays missing; don't retry it.
    retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
  });
}

export default useGetCycle;
