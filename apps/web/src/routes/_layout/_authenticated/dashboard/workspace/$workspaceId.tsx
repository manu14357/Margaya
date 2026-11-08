import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { guestMayOpen, isGuestRole } from "@/lib/guest-access";

// The workspace root is Home, whatever the number of projects.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: me } = useGetActiveWorkspaceUser();

  // A guest has no Home or workspace-wide screens (the API refuses them too);
  // their projects are where they land.
  if (isGuestRole(me?.role) && !guestMayOpen(pathname)) {
    return (
      <Navigate
        to="/dashboard/workspace/$workspaceId/projects"
        params={{ workspaceId }}
        replace
      />
    );
  }

  return <Outlet />;
}
