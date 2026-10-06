import { createFileRoute } from "@tanstack/react-router";
import WorkspaceViewsPage from "@/components/view/workspace-views-page";

type WorkspaceViewSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/views/$viewId",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): WorkspaceViewSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, viewId } = Route.useParams();
  const { taskId } = Route.useSearch();
  return (
    <WorkspaceViewsPage
      workspaceId={workspaceId}
      viewId={viewId}
      taskId={taskId}
    />
  );
}
