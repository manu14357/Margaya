import { useQuery } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import type { MyWorkspacePermissions } from "@/fetchers/workspace/get-my-workspace-permissions";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { myWorkspacePermissionsQuery } from "@/hooks/queries/workspace/use-my-workspace-permissions";

function toMember(permissions: MyWorkspacePermissions) {
  return {
    userId: permissions.userId,
    role: permissions.role,
    createdAt: permissions.joinedAt,
  };
}

/**
 * My membership of the active workspace (role and join date), from the same
 * query as my permissions rather than the whole member list.
 */
export const useGetActiveWorkspaceUser = () => {
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  return useQuery({
    ...myWorkspacePermissionsQuery(workspace?.id, user?.id),
    select: toMember,
  });
};
