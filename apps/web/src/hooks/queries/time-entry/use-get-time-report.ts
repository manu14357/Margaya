import { useQuery } from "@tanstack/react-query";
import getTimeReport from "@/fetchers/time-entry/get-time-report";
import { analyticsQueryOptions } from "@/hooks/queries/analytics/query-options";
import { analyticsKeys, analyticsScopeKey } from "@/lib/analytics/scope-key";
import { useUserTimeZone } from "@/lib/task-query/request";

/** Time totals by person and project; refreshes like the other analytics. */
function useGetTimeReport({
  workspaceId,
  projectIds,
  from,
  to,
}: {
  workspaceId: string;
  projectIds?: readonly string[];
  from: string;
  to: string;
}) {
  const timeZone = useUserTimeZone();
  const scopeKey = analyticsScopeKey(projectIds);
  return useQuery({
    queryKey: analyticsKeys.time(workspaceId, scopeKey, from, to, timeZone),
    queryFn: ({ signal }) =>
      getTimeReport({ workspaceId, projectIds, timeZone, from, to }, signal),
    enabled: Boolean(workspaceId),
    ...analyticsQueryOptions,
  });
}

export default useGetTimeReport;
