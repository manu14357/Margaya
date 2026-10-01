import { keepPreviousData, useQuery } from "@tanstack/react-query";
import getAnalyticsIntake, {
  type AnalyticsIntakeParams,
} from "@/fetchers/analytics/get-analytics-intake";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { stableHash } from "@/lib/task-query/filter-tree";
import { analyticsQueryOptions } from "./query-options";

/** Intake analytics for a period; enabled only while the Intake tab is open. */
export function useAnalyticsIntake(
  params: AnalyticsIntakeParams,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const scopeKey = analyticsScopeKey(params.projectIds);
  const { workspaceId, from, to, bucket, weekStartsOn, timeZone } = params;
  const hash = stableHash({ from, to, bucket, weekStartsOn, timeZone });
  return useQuery({
    queryKey: analyticsKeys.intake(workspaceId, scopeKey, hash),
    queryFn: ({ signal }) => getAnalyticsIntake(params, signal),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: keepPreviousData,
    ...analyticsQueryOptions,
  });
}
