import { keepPreviousData, useQuery } from "@tanstack/react-query";
import getAnalyticsWorkload from "@/fetchers/analytics/get-analytics-workload";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { analyticsQueryOptions } from "./query-options";

export function useAnalyticsWorkload({
  workspaceId,
  projectIds,
}: {
  workspaceId: string;
  projectIds?: readonly string[];
}) {
  const scopeKey = analyticsScopeKey(projectIds);
  return useQuery({
    queryKey: analyticsKeys.workload(workspaceId, scopeKey),
    queryFn: ({ signal }) =>
      getAnalyticsWorkload({ workspaceId, projectIds }, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    ...analyticsQueryOptions,
  });
}
