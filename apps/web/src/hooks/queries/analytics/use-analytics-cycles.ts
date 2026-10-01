import { useQuery } from "@tanstack/react-query";
import getAnalyticsCycles from "@/fetchers/analytics/get-analytics-cycles";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { analyticsQueryOptions } from "./query-options";

/** Cycle analytics; enabled only while the Cycles tab is open. */
export function useAnalyticsCycles({
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
    queryKey: analyticsKeys.cycles(workspaceId, scopeKey),
    queryFn: ({ signal }) =>
      getAnalyticsCycles({ workspaceId, projectIds }, signal),
    enabled: Boolean(workspaceId) && enabled,
    ...analyticsQueryOptions,
  });
}
