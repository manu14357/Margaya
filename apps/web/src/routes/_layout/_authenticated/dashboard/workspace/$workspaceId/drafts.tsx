import { createFileRoute } from "@tanstack/react-router";
import DraftsPage from "@/components/task-draft/drafts-page";

type DraftsSearchParams = {
  q?: string;
  /** A project id, or "none" for drafts without a project. */
  projectId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/drafts",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DraftsSearchParams => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    projectId:
      typeof search.projectId === "string" && search.projectId
        ? search.projectId
        : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { q, projectId } = Route.useSearch();
  return <DraftsPage workspaceId={workspaceId} q={q} projectId={projectId} />;
}
