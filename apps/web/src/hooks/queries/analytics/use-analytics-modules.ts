import { useQuery } from "@tanstack/react-query";
import getAnalyticsModules from "@/fetchers/analytics/get-analytics-modules";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { analyticsQueryOptions } from "./query-options";

/** Module analytics; enabled only while the Modules tab is open. */
export function useAnalyticsModules({
  workspaceId,
  projectIds,
  enabled = true,
}: {
  workspaceId: string;
  projectIds?: readonly string[];
  enabled?: boolean;
}) {
  const scopeKey = analyticsScopeKey(projectIds);
  return useQuery({
    queryKey: analyticsKeys.modules(workspaceId, scopeKey),
    queryFn: ({ signal }) =>
      getAnalyticsModules({ workspaceId, projectIds }, signal),
    enabled: Boolean(workspaceId) && enabled,
    ...analyticsQueryOptions,
  });
}
