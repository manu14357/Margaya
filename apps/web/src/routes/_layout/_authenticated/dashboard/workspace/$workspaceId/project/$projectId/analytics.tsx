import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import AnalyticsPage from "@/components/analytics/analytics-page";
import {
  type AnalyticsTab,
  defaultAnalyticsTab,
  isAnalyticsTab,
} from "@/lib/analytics/tabs";

type ProjectAnalyticsSearchParams = {
  tab?: AnalyticsTab;
  /** Opened from a cycle: counts only its tasks until the chip is removed. */
  cycleId?: string;
  /** Opened from a module, likewise. */
  moduleId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/analytics",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): ProjectAnalyticsSearchParams => {
    const cycleId =
      typeof search.cycleId === "string" && search.cycleId
        ? search.cycleId
        : undefined;
    return {
      tab:
        isAnalyticsTab(search.tab) && search.tab !== "overview"
          ? search.tab
          : undefined,
      cycleId,
      // One context at a time; a cycle wins.
      moduleId:
        !cycleId && typeof search.moduleId === "string" && search.moduleId
          ? search.moduleId
          : undefined,
    };
  },
});

function RouteComponent() {
  const { workspaceId, projectId } = Route.useParams();
  const { tab, cycleId, moduleId } = Route.useSearch();
  const navigate = useNavigate();

  const handleTabChange = useCallback(
    (next: AnalyticsTab, options?: { replace?: boolean }) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          tab: next === defaultAnalyticsTab("project") ? undefined : next,
        }),
        replace: options?.replace,
      }),
    [navigate],
  );

  const handleClearContext = useCallback(
    () =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          cycleId: undefined,
          moduleId: undefined,
        }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <AnalyticsPage
      scope="project"
      workspaceId={workspaceId}
      projectId={projectId}
      tab={tab}
      cycleId={cycleId}
      moduleId={moduleId}
      onTabChange={handleTabChange}
      onClearContext={handleClearContext}
    />
  );
}
