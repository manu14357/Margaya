import { useQuery } from "@tanstack/react-query";
import getIntakeItemByTask from "@/fetchers/intake/get-intake-item-by-task";
import { intakeQueryKeys } from "./intake-query-keys";

/**
 * The request a task came from. Most tasks didn't come from intake: the
 * 404 is the normal answer, so it isn't retried.
 */
export function useGetIntakeItemByTask(
  taskId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: intakeQueryKeys.byTask(taskId ?? ""),
    queryFn: () => getIntakeItemByTask(taskId ?? ""),
    enabled: Boolean(taskId) && enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export default useGetIntakeItemByTask;
