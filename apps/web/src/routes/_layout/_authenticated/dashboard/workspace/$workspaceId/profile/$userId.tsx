import { createFileRoute } from "@tanstack/react-router";
import MemberProfilePage from "@/components/member-profile/member-profile-page";

type MemberProfileSearchParams = {
  tab?: "assigned";
  /** An overview tile's filters for the assigned list (open, overdue). */
  filter?: string;
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/profile/$userId",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): MemberProfileSearchParams => ({
    tab: search.tab === "assigned" ? "assigned" : undefined,
    filter: typeof search.filter === "string" ? search.filter : undefined,
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, userId } = Route.useParams();
  const { tab, filter, taskId } = Route.useSearch();
  return (
    <MemberProfilePage
      key={userId}
      workspaceId={workspaceId}
      userId={userId}
      tab={tab ?? "overview"}
      preset={filter}
      taskId={taskId}
    />
  );
}
