import { useMutation } from "@tanstack/react-query";
import setInvitationProjects from "@/fetchers/invitation/set-invitation-projects";
import { authClient } from "@/lib/auth-client";
import { HttpError } from "@/lib/http-error";
import { InvitationProjectsError } from "@/lib/invite-emails";
import queryClient from "@/query-client";

type InviteWorkspaceUserRequest = {
  workspaceId: string;
  email: string;
  // viewer, member, admin or a custom workspace role. The API refuses a role
  // above the inviter's own.
  role: string;
  resend?: boolean;
  /** Projects the invitee joins on accepting (a guest's first projects). */
  projects?: { projectId: string; role: string }[];
};

function useInviteWorkspaceUser() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      email,
      role,
      resend,
      projects,
    }: InviteWorkspaceUserRequest) => {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        // The client types only know the static roles; custom roles are
        // validated server side against workspace_role.
        role: role as "member",
        organizationId: workspaceId,
        resend,
      });

      if (error) {
        // Keep the status: bulk invites stop on a 429 instead of retrying.
        throw new HttpError(
          error.status,
          error.message || "Failed to invite workspace member",
        );
      }

      if (projects?.length && data?.id) {
        try {
          await setInvitationProjects(data.id, projects);
        } catch (error) {
          throw new InvitationProjectsError(
            error instanceof Error ? error.message : "",
          );
        }
      }

      return data;
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    },
  });
}

export default useInviteWorkspaceUser;
