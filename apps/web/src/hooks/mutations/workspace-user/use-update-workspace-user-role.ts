import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

type UpdateWorkspaceUserRoleRequest = {
  workspaceId: string;
  memberId: string;
  role: string;
};

function useUpdateWorkspaceUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workspaceId,
      memberId,
      role,
    }: UpdateWorkspaceUserRoleRequest) => {
      const { data, error } = await authClient.organization.updateMemberRole({
        memberId,
        organizationId: workspaceId,
        role: role as "admin" | "member" | "owner",
      });

      if (error) {
        throw new Error(
          error.message || "Failed to update workspace member role",
        );
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      // The members page reads from useGetFullWorkspace which keys by
      // ["workspace", "full", workspaceId], so invalidate that exact prefix
      // so the table re-renders with the new role.
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-users", variables.workspaceId],
      });
      // The active user's role may have changed: my role and permissions
      // (useMyWorkspacePermissions, which useGetActiveWorkspaceUser and the
      // capability checks read) refetch.
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
    },
  });
}

export default useUpdateWorkspaceUserRole;
