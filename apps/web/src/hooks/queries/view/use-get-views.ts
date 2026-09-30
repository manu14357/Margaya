import { useQuery } from "@tanstack/react-query";
import listViews from "@/fetchers/view/list-views";
import { viewQueryKeys } from "./view-query-keys";

/**
 * A project's views, or the workspace's (projectId null). Workspace views
 * have no socket, so they refresh on focus and after one's own changes.
 */
export function useGetViews({
  workspaceId,
  projectId,
  mine = false,
  enabled = true,
}: {
  workspaceId: string;
  projectId: string | null;
  mine?: boolean;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: viewQueryKeys.list(workspaceId, projectId, mine),
    queryFn: () => listViews({ workspaceId, projectId, mine }),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export default useGetViews;
