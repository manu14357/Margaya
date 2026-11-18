import { createFileRoute, redirect } from "@tanstack/react-router";
import { getPendingInvitations } from "@/fetchers/invitation/get-pending-invitations";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import { authClient } from "@/lib/auth-client";
import { handleUnauthorized, isUnauthorizedError } from "@/lib/http-error";
import { routeSession } from "@/lib/route-session";
import type Workspace from "@/types/workspace";

export const Route = createFileRoute("/_layout/_authenticated/dashboard/")({
  beforeLoad: async () => {
    let workspaces: Workspace[];
    let invitations: Awaited<ReturnType<typeof getPendingInvitations>>;
    try {
      [workspaces, invitations] = await Promise.all([
        getWorkspaces(),
        getPendingInvitations(),
      ]);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      throw error;
    }

    if (invitations && invitations.length > 0 && !workspaces.length) {
      throw redirect({ to: "/invitations" });
    }

    // Usually the session the authenticated layout just read.
    const session = await routeSession().catch(() => null);
    const activeWorkspaceId = session?.session?.activeOrganizationId;

    if (workspaces && workspaces.length > 0) {
      if (
        activeWorkspaceId &&
        workspaces.some((ws) => ws.id === activeWorkspaceId)
      ) {
        throw redirect({
          to: "/dashboard/workspace/$workspaceId",
          params: { workspaceId: activeWorkspaceId },
        });
      }

      const firstWorkspace = workspaces[0];

      authClient.organization.setActive({
        organizationId: firstWorkspace.id,
      });

      throw redirect({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: firstWorkspace.id },
      });
    }
    throw redirect({ to: "/onboarding" });
  },
});
