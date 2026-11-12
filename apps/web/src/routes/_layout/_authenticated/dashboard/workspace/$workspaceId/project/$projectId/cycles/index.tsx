import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@/components/common/filter-bar";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import ProjectLayout from "@/components/common/project-layout";
import CycleFormDialog from "@/components/cycle/cycle-form-dialog";
import CycleList from "@/components/cycle/cycle-list";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type CyclesSearchParams = {
  view?: "archived";
  q?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/cycles/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): CyclesSearchParams => ({
    view: search.view === "archived" ? "archived" : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { view, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreateCycles, isCheckingPermissions } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canCreate = !isCheckingPermissions && canCreateCycles();
  const listView = view === "archived" ? "archived" : "cycles";

  const setSearch = (next: CyclesSearchParams) =>
    navigate({
      search: (previous: CyclesSearchParams) => ({ ...previous, ...next }),
      replace: true,
    });

  // The top bar keeps the one primary action; search and the archived
  // switch sit in the filter bar above the list.
  const headerActions = canCreate ? (
    <Button size="xs" className="gap-1" onClick={() => setIsCreateOpen(true)}>
      <Plus className="size-3" />
      <TopBarLabel>{t("cycles:page.newCycle")}</TopBarLabel>
    </Button>
  ) : null;

  const filterBar = (
    <FilterBar
      trailing={
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[listView]}
          onValueChange={(values) => {
            const next = values[0];
            if (!next) return;
            setSearch({ view: next === "archived" ? "archived" : undefined });
          }}
        >
          <Toggle value="cycles" className="px-2 text-xs">
            {t("cycles:page.viewCycles")}
          </Toggle>
          <Toggle value="archived" className="px-2 text-xs">
            {t("cycles:page.viewArchived")}
          </Toggle>
        </ToggleGroup>
      }
    >
      <div className="relative w-full max-w-60">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
        <Input
          value={q ?? ""}
          maxLength={100}
          onChange={(event) =>
            setSearch({ q: event.target.value || undefined })
          }
          placeholder={t("cycles:page.searchPlaceholder")}
          aria-label={t("cycles:page.searchPlaceholder")}
          className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
        />
      </div>
    </FilterBar>
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="cycles"
      headerActions={headerActions}
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${t("cycles:nav.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="cycles"
      >
        <div className="flex h-full min-h-0 flex-col">
          {filterBar}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CycleList
              projectId={projectId}
              workspaceId={workspaceId}
              view={listView}
              query={q ?? ""}
              onCreate={canCreate ? () => setIsCreateOpen(true) : undefined}
            />
          </div>
        </div>
        {canCreate && (
          <CycleFormDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
