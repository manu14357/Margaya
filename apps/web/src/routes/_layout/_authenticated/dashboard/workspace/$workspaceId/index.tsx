import { createFileRoute } from "@tanstack/react-router";
import HomePage from "@/components/home/home-page";

type HomeSearchParams = {
  /** With projectId, opens the task side sheet over Home. */
  taskId?: string;
  projectId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): HomeSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    projectId:
      typeof search.projectId === "string" ? search.projectId : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { taskId, projectId } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <HomePage
      workspaceId={workspaceId}
      taskId={taskId}
      projectId={projectId}
      onOpenTask={(nextTaskId, nextProjectId) =>
        navigate({
          search: { taskId: nextTaskId, projectId: nextProjectId },
        })
      }
      onCloseTask={() =>
        navigate({ search: { taskId: undefined, projectId: undefined } })
      }
    />
  );
}
