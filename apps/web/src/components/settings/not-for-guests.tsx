import { Navigate, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { isGuestRole } from "@/lib/guest-access";

/**
 * Workspace and project settings are not a guest's (the API refuses them too);
 * their account settings are what's left.
 */
export default function NotForGuests({ children }: { children?: ReactNode }) {
  const { data: me } = useGetActiveWorkspaceUser();
  if (isGuestRole(me?.role)) {
    return <Navigate to="/dashboard/settings/account/information" replace />;
  }
  return children ?? <Outlet />;
}
