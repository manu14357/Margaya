import { createFileRoute } from "@tanstack/react-router";
import MyWorkPage from "@/components/my-work/my-work-page";
import { isMyWorkTab, type MyWorkTab } from "@/lib/task-query/my-work";

type MyWorkSearchParams = {
  tab?: Exclude<MyWorkTab, "summary">;
  /** A summary tile's filters for the tab (open, overdue, a project). */
  filter?: string;
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/my-work",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): MyWorkSearchParams => ({
    tab:
      isMyWorkTab(search.tab) && search.tab !== "summary"
        ? search.tab
        : undefined,
    filter: typeof search.filter === "string" ? search.filter : undefined,
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { tab, filter, taskId } = Route.useSearch();
  return (
    <MyWorkPage
      workspaceId={workspaceId}
      tab={tab ?? "summary"}
      preset={filter}
      taskId={taskId}
    />
  );
}
