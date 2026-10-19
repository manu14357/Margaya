import { useQuery } from "@tanstack/react-query";
import getAnalyticsReports from "@/fetchers/analytics-report/get-analytics-reports";
import { analyticsReportQueryKeys } from "./analytics-report-query-keys";

/** Saved reports have no realtime; they refresh after this user's changes. */
export function useAnalyticsReports(
  workspaceId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: analyticsReportQueryKeys.list(workspaceId),
    queryFn: () => getAnalyticsReports(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
  });
}

export default useAnalyticsReports;
