import { useQuery } from "@tanstack/react-query";
import getRecentVisits, {
  type RecentVisitEntityType,
} from "@/fetchers/recent-visit/get-recent-visits";

/** The caller's recent visits, newest first. The Home widget reads it. */
function useGetRecentVisits({
  workspaceId,
  entityType,
  limit,
}: {
  workspaceId: string;
  entityType?: RecentVisitEntityType;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["recent-visits", workspaceId, entityType ?? "all", limit ?? 20],
    queryFn: () => getRecentVisits({ workspaceId, entityType, limit }),
    enabled: Boolean(workspaceId),
  });
}

export default useGetRecentVisits;
