import { queryOptions, useQuery } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import getMyWorkspacePermissions from "@/fetchers/workspace/get-my-workspace-permissions";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/**
 * One query for my role and permissions in a workspace. Role changes, role
 * edits and membership changes invalidate the `["workspace-capabilities",
 * workspaceId]` prefix (or the whole root, from the user socket).
 */
export function myWorkspacePermissionsQuery(
  workspaceId: string | undefined,
  userId: string | undefined,
) {
  return queryOptions({
    queryKey: ["workspace-capabilities", workspaceId, userId] as const,
    queryFn: () => getMyWorkspacePermissions(workspaceId as string),
    enabled: Boolean(workspaceId && userId),
    staleTime: 5 * 60 * 1000,
  });
}

/** My role and permissions in the active workspace. */
export function useMyWorkspacePermissions() {
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  return useQuery(myWorkspacePermissionsQuery(workspace?.id, user?.id));
}
