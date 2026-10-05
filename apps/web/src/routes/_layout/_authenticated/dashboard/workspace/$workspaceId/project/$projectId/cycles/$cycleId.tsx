import { createFileRoute } from "@tanstack/react-router";
import CycleBoardPage from "@/components/cycle/cycle-board-page";

type CycleSearchParams = {
  taskId?: string;
  panel?: "closed";
  /** "plan" opens the split-view planner instead of the board. */
  mode?: "plan";
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): CycleSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    panel: search.panel === "closed" ? "closed" : undefined,
    mode: search.mode === "plan" ? "plan" : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId, cycleId } = Route.useParams();
  const { taskId, panel, mode } = Route.useSearch();

  return (
    <CycleBoardPage
      key={cycleId}
      workspaceId={workspaceId}
      projectId={projectId}
      cycleId={cycleId}
      taskId={taskId}
      panel={panel}
      mode={mode}
    />
  );
}
