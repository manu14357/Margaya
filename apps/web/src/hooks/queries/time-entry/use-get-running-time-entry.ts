import { useQuery } from "@tanstack/react-query";
import getRunningTimeEntry from "@/fetchers/time-entry/get-running-time-entry";

export const RUNNING_TIME_ENTRY_KEY = "time-entry-running";

/** The caller's running timer in this workspace; `entry` is null when none. */
function useGetRunningTimeEntry(workspaceId: string) {
  return useQuery({
    queryKey: [RUNNING_TIME_ENTRY_KEY, workspaceId],
    queryFn: () => getRunningTimeEntry(workspaceId),
    enabled: !!workspaceId,
  });
}

export default useGetRunningTimeEntry;
