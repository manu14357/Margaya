import { createFileRoute, useNavigate } from "@tanstack/react-router";
import ModulesPage from "@/components/module/modules-page";

type ModulesSearchParams = {
  view?: "archived";
  q?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/modules/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): ModulesSearchParams => ({
    view: search.view === "archived" ? "archived" : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
});

function RouteComponent() {
  const { projectId, workspaceId } = Route.useParams();
  const { view, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const setSearch = (next: ModulesSearchParams) =>
    navigate({
      search: (previous: ModulesSearchParams) => ({ ...previous, ...next }),
      replace: true,
    });

  return (
    <ModulesPage
      workspaceId={workspaceId}
      projectId={projectId}
      view={view === "archived" ? "archived" : "active"}
      query={q ?? ""}
      onQueryChange={(query) => setSearch({ q: query || undefined })}
      onViewChange={(next) =>
        setSearch({ view: next === "archived" ? "archived" : undefined })
      }
    />
  );
}
