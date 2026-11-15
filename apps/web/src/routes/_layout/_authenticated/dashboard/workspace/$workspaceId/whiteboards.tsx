import { createFileRoute } from "@tanstack/react-router";
import WorkspaceWhiteboardsScreen from "@/components/whiteboard/workspace-whiteboards-screen";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/whiteboards",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  return <WorkspaceWhiteboardsScreen workspaceId={workspaceId} />;
}
