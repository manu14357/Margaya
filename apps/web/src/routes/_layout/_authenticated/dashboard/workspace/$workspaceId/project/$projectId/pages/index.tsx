import { createFileRoute, useNavigate } from "@tanstack/react-router";
import PagesScreen from "@/components/page/pages-screen";
import { isPageListTab } from "@/lib/pages/filter-sort-pages";
import type { PageListTab } from "@/types/page";

type PagesSearchParams = { tab?: PageListTab };

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/pages/",
)({
  component: RouteComponent,
  // Missing or unknown tabs mean Public.
  validateSearch: (search: Record<string, unknown>): PagesSearchParams => ({
    tab:
      isPageListTab(search.tab) && search.tab !== "public"
        ? search.tab
        : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId, projectId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <PagesScreen
      workspaceId={workspaceId}
      projectId={projectId}
      tab={tab ?? "public"}
      onTabChange={(next) =>
        navigate({
          search: { tab: next === "public" ? undefined : next },
          replace: true,
        })
      }
    />
  );
}
