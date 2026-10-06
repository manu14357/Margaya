import { createFileRoute } from "@tanstack/react-router";
import ProjectViewPage from "@/components/view/project-view-page";

type ProjectViewSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/views/$viewId",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): ProjectViewSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId, viewId } = Route.useParams();
  const { taskId } = Route.useSearch();
  return (
    <ProjectViewPage
      key={viewId}
      workspaceId={workspaceId}
      projectId={projectId}
      viewId={viewId}
      taskId={taskId}
    />
  );
}
