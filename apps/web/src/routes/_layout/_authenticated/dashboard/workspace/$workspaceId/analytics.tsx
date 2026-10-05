import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import AnalyticsPage from "@/components/analytics/analytics-page";
import { parseProjectIdsParam } from "@/lib/analytics/scope-key";
import {
  type AnalyticsTab,
  defaultAnalyticsTab,
  isAnalyticsTab,
} from "@/lib/analytics/tabs";

type AnalyticsSearchParams = {
  tab?: AnalyticsTab;
  /** Comma-separated project ids; absent means every project. */
  projects?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/analytics",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): AnalyticsSearchParams => ({
    tab: isAnalyticsTab(search.tab) ? search.tab : undefined,
    projects:
      typeof search.projects === "string" && search.projects.trim()
        ? search.projects
        : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { tab, projects } = Route.useSearch();
  const navigate = useNavigate();
  const selectedProjectIds = useMemo(
    () => parseProjectIdsParam(projects),
    [projects],
  );

  const handleTabChange = useCallback(
    (next: AnalyticsTab, options?: { replace?: boolean }) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          tab: next === defaultAnalyticsTab("workspace") ? undefined : next,
        }),
        replace: options?.replace,
      }),
    [navigate],
  );

  const handleProjectsChange = useCallback(
    (ids: string[]) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          projects: ids.length ? ids.join(",") : undefined,
        }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <AnalyticsPage
      scope="workspace"
      workspaceId={workspaceId}
      tab={tab}
      selectedProjectIds={selectedProjectIds}
      onTabChange={handleTabChange}
      onProjectsChange={handleProjectsChange}
    />
  );
}
