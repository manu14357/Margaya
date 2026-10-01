import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import queryAnalyticsTrend from "@/fetchers/analytics/query-analytics-trend";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { stableHash } from "@/lib/task-query/filter-tree";
import type { AnalyticsTrendRequest } from "@/types/analytics";
import { analyticsQueryOptions } from "./query-options";

/** Created vs completed; keeps the previous series while a new one loads. */
export function useAnalyticsTrend(
  request: AnalyticsTrendRequest | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const workspaceId = request?.workspaceId ?? "";
  const scopeKey = analyticsScopeKey(request?.scope?.projectIds);
  const hash = useMemo(() => stableHash(request), [request]);
  return useQuery({
    queryKey: analyticsKeys.trend(workspaceId, scopeKey, hash),
    queryFn: ({ signal }) => {
      if (!request) throw new Error("No analytics trend request");
      return queryAnalyticsTrend(request, signal);
    },
    enabled: Boolean(request?.workspaceId) && enabled,
    placeholderData: keepPreviousData,
    ...analyticsQueryOptions,
  });
}
