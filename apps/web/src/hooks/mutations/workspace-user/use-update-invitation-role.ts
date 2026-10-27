import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateInvitationRole from "@/fetchers/invitation/update-invitation-role";

type UpdateInvitationRoleRequest = {
  workspaceId: string;
  invitationId: string;
  role: string;
};

function useUpdateInvitationRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invitationId, role }: UpdateInvitationRoleRequest) =>
      updateInvitationRole(invitationId, role),
    onSuccess: (_data, { workspaceId }) => {
      // The members page lists pending invitations from the full workspace.
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });
    },
  });
}

export default useUpdateInvitationRole;
