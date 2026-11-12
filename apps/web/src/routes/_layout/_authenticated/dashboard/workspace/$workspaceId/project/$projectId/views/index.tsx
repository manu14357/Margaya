import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@/components/common/filter-bar";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import ViewFormDialog from "@/components/view/view-form-dialog";
import ViewsList from "@/components/view/views-list";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { useUserPreferencesStore } from "@/store/user-preferences";

type ViewsSearchParams = {
  q?: string;
  mine?: boolean;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/views/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): ViewsSearchParams => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    mine: search.mine === true || search.mine === "true" ? true : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { q, mine } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreateViews, isCheckingPermissions } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canCreate = !isCheckingPermissions && canCreateViews();
  // A new view starts from the Tasks section's current filters and layout.
  const tasksState = useTaskQueryState({
    storageScope: projectId,
    scope: "project",
    workspaceId,
    readOnly: true,
  });
  const viewMode = useUserPreferencesStore((state) => state.viewMode);

  const setSearch = (next: ViewsSearchParams) =>
    navigate({
      search: (previous: ViewsSearchParams) => ({ ...previous, ...next }),
      replace: true,
    });

  // The lens bar: search and the All/Mine switch. The top bar keeps the one
  // primary action.
  const lens = (
    <FilterBar
      trailing={
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[mine ? "mine" : "all"]}
          onValueChange={(values) => {
            const next = values[0];
            if (!next) return;
            setSearch({ mine: next === "mine" ? true : undefined });
          }}
        >
          <Toggle value="all" className="px-2 text-xs">
            {t("views:list.all")}
          </Toggle>
          <Toggle value="mine" className="px-2 text-xs">
            {t("views:list.mine")}
          </Toggle>
        </ToggleGroup>
      }
    >
      <div className="relative w-full max-w-64">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
        <Input
          value={q ?? ""}
          maxLength={100}
          onChange={(event) =>
            setSearch({ q: event.target.value || undefined })
          }
          placeholder={t("views:list.searchPlaceholder")}
          aria-label={t("views:list.searchPlaceholder")}
          className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
        />
      </div>
    </FilterBar>
  );

  const headerActions = canCreate ? (
    <Button
      variant="outline"
      size="xs"
      className="gap-1"
      onClick={() => setIsCreateOpen(true)}
    >
      <Plus className="size-3" />
      <TopBarLabel>{t("views:list.newView")}</TopBarLabel>
    </Button>
  ) : null;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="views"
      headerActions={headerActions}
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${t("views:nav.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="views"
      >
        <div className="flex h-full min-h-0 flex-col">
          {lens}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ViewsList
              workspaceId={workspaceId}
              projectId={projectId}
              query={q ?? ""}
              mine={Boolean(mine)}
              onCreate={canCreate ? () => setIsCreateOpen(true) : undefined}
            />
          </div>
        </div>
        {canCreate && (
          <ViewFormDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            workspaceId={workspaceId}
            projectId={projectId}
            currentState={{
              ...tasksState.state,
              display: { ...tasksState.state.display, layout: viewMode },
            }}
            onSaved={(view) =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/views/$viewId",
                params: { workspaceId, projectId, viewId: view.id },
              })
            }
          />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
