import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import queryAnalyticsChart from "@/fetchers/analytics/query-analytics-chart";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { stableHash } from "@/lib/task-query/filter-tree";
import type { AnalyticsChartRequest } from "@/types/analytics";
import { analyticsQueryOptions } from "./query-options";

/**
 * A chart request's result. The previous result stays on screen while a
 * changed request loads (`isPlaceholderData`), so controls never blank it.
 */
export function useAnalyticsChart(
  request: AnalyticsChartRequest | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const workspaceId = request?.workspaceId ?? "";
  const scopeKey = analyticsScopeKey(request?.scope?.projectIds);
  const hash = useMemo(() => stableHash(request), [request]);
  return useQuery({
    queryKey: analyticsKeys.chart(workspaceId, scopeKey, hash),
    queryFn: ({ signal }) => {
      if (!request) throw new Error("No analytics chart request");
      return queryAnalyticsChart(request, signal);
    },
    enabled: Boolean(request?.workspaceId) && enabled,
    placeholderData: keepPreviousData,
    ...analyticsQueryOptions,
  });
}
