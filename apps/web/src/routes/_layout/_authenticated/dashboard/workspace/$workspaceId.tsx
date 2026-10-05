import { createFileRoute, Outlet } from "@tanstack/react-router";

// The workspace root is Home, whatever the number of projects.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
