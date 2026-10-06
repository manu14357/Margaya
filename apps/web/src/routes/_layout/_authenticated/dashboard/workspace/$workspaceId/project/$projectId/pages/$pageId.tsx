import { createFileRoute, useNavigate } from "@tanstack/react-router";
import PageScreen from "@/components/page/page-screen";
import type { PagePanel } from "@/types/page";

type PageSearchParams = { panel?: PagePanel; version?: string };

const PANELS: readonly string[] = ["outline", "info", "history"];

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): PageSearchParams => ({
    panel:
      typeof search.panel === "string" && PANELS.includes(search.panel)
        ? (search.panel as PagePanel)
        : undefined,
    version:
      typeof search.version === "string" && search.version
        ? search.version
        : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId, pageId } = Route.useParams();
  const { panel, version } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <PageScreen
      key={pageId}
      workspaceId={workspaceId}
      projectId={projectId}
      pageId={pageId}
      panel={panel}
      versionId={version}
      onSearchChange={(next) => navigate({ search: next, replace: true })}
    />
  );
}
