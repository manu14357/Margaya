import { createFileRoute } from "@tanstack/react-router";
import UpdatesScreen from "@/components/project-update/updates-screen";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/updates",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId, projectId } = Route.useParams();
  return <UpdatesScreen workspaceId={workspaceId} projectId={projectId} />;
}
