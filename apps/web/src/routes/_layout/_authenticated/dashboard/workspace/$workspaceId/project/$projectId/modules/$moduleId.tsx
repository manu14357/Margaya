import { createFileRoute } from "@tanstack/react-router";
import ModulePage from "@/components/module/module-page";

type ModuleSearchParams = {
  taskId?: string;
  panel?: "closed";
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): ModuleSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    panel: search.panel === "closed" ? "closed" : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId, moduleId } = Route.useParams();
  const { taskId, panel } = Route.useSearch();

  return (
    <ModulePage
      key={moduleId}
      workspaceId={workspaceId}
      projectId={projectId}
      moduleId={moduleId}
      taskId={taskId}
      panel={panel}
    />
  );
}
