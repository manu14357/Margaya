import { useQuery } from "@tanstack/react-query";
import getForecast from "@/fetchers/delivery/get-forecast";
import getHomeRisks from "@/fetchers/delivery/get-home-risks";
import getRisks from "@/fetchers/delivery/get-risks";
import type { DeliveryScopeType } from "@/types/delivery";
import { deliveryQueryKeys } from "./delivery-query-keys";

type ScopeArgs = {
  projectId: string;
  scope: DeliveryScopeType;
  id: string | undefined;
  enabled?: boolean;
};

// Computed on the server per request; a minute of freshness keeps a busy
// board from recomputing on every remount. Task changes invalidate them, and
// a stale or invalidated result reloads on mount: the app's default is not
// to refetch on mount, which would show a cycle's old forecast after a
// change made while its page was closed.
const STALE_MS = 60_000;

export function useForecast({
  projectId,
  scope,
  id,
  enabled = true,
}: ScopeArgs) {
  return useQuery({
    queryKey: deliveryQueryKeys.forecast(projectId, scope, id ?? ""),
    queryFn: ({ signal }) => getForecast(scope, id ?? "", signal),
    enabled: Boolean(projectId && id) && enabled,
    staleTime: STALE_MS,
    refetchOnMount: true,
  });
}

export function useRisks({ projectId, scope, id, enabled = true }: ScopeArgs) {
  return useQuery({
    queryKey: deliveryQueryKeys.risks(projectId, scope, id ?? ""),
    queryFn: ({ signal }) => getRisks(scope, id ?? "", signal),
    enabled: Boolean(projectId && id) && enabled,
    staleTime: STALE_MS,
    refetchOnMount: true,
  });
}

export function useHomeRisks(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: deliveryQueryKeys.home(workspaceId),
    queryFn: ({ signal }) => getHomeRisks(workspaceId, signal),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 5 * 60_000,
    refetchOnMount: true,
  });
}
