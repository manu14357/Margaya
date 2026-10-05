import { useQuery } from "@tanstack/react-query";
import getArchiveSummary from "@/fetchers/archive/get-archive-summary";
import { archiveQueryKeys } from "./archive-query-keys";

/**
 * Archived counts per tab. The workspace scope has no project socket, so it
 * refetches every 30 s while visible and on focus.
 */
export function useArchiveSummary(workspaceId: string, projectId?: string) {
  return useQuery({
    queryKey: archiveQueryKeys.summary(workspaceId, projectId),
    queryFn: () => getArchiveSummary(workspaceId, projectId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: projectId ? false : 30_000,
    refetchIntervalInBackground: false,
  });
}

export default useArchiveSummary;
