import { useQuery } from "@tanstack/react-query";
import getAnalyticsOverview from "@/fetchers/analytics/get-analytics-overview";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { browserTimeZone } from "@/lib/task-query/request";
import { analyticsQueryOptions } from "./query-options";

export function useAnalyticsOverview({
  workspaceId,
  projectIds,
  enabled = true,
}: {
  workspaceId: string;
  projectIds?: readonly string[];
  enabled?: boolean;
}) {
  const scopeKey = analyticsScopeKey(projectIds);
  const timeZone = browserTimeZone();
  return useQuery({
    queryKey: analyticsKeys.overview(workspaceId, scopeKey, timeZone),
    queryFn: ({ signal }) =>
      getAnalyticsOverview({ workspaceId, projectIds, timeZone }, signal),
    enabled: Boolean(workspaceId) && enabled,
    ...analyticsQueryOptions,
  });
}
