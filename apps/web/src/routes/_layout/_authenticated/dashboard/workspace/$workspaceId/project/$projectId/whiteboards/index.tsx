import { createFileRoute } from "@tanstack/react-router";
import WhiteboardsScreen from "@/components/whiteboard/whiteboards-screen";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId, projectId } = Route.useParams();
  return <WhiteboardsScreen workspaceId={workspaceId} projectId={projectId} />;
}
