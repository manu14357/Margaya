import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

/** Better Auth's answer when the last owner tries to leave. */
export const LAST_OWNER_CODE =
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER";

export class LeaveWorkspaceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LeaveWorkspaceError";
    this.code = code;
  }
}

/**
 * Leaves a workspace. The server refuses the last owner and runs the same
 * follow-up as an admin removing the member.
 */
function useLeaveWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const { error } = await authClient.organization.leave({
        organizationId: workspaceId,
      });
      if (error) {
        throw new LeaveWorkspaceError(
          error.message || "Failed to leave the workspace",
          error.code,
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await queryClient.invalidateQueries({
        queryKey: ["active-organization"],
      });
    },
  });
}

export default useLeaveWorkspace;
