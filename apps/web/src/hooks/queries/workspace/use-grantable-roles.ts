import { useMemo } from "react";
import { authClient } from "@/lib/auth-client";
import { grantableRoles } from "@/lib/grantable-roles";
import useWorkspaceRoles from "./use-workspace-roles";

/**
 * Roles `myRole` may grant in the workspace (see lib/grantable-roles). While
 * the roles load, or if the caller cannot list them, the built-in defaults
 * are compared instead.
 */
function useGrantableRoles(
  workspaceId: string | undefined,
  myRole: string | null | undefined,
) {
  const { data: workspaceRoles = [], isLoading } =
    useWorkspaceRoles(workspaceId);
  const { data: session } = authClient.useSession();
  const instanceAdmin = session?.user?.role === "admin";

  const roles = useMemo(
    () => grantableRoles({ workspaceRoles, myRole, unlimited: instanceAdmin }),
    [workspaceRoles, myRole, instanceAdmin],
  );

  return { roles, isLoading };
}

export default useGrantableRoles;
