import { useNavigate } from "@tanstack/react-router";
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
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { EMPTY_MODULE_FILTERS, hasModuleFilters } from "@/lib/module/display";
import type { ModuleListView } from "@/types/module";
import ModuleFormDialog from "./module-form-dialog";
import ModulesDisplayMenu from "./modules-display-menu";
import ModulesFilterMenu, { ModulesFilterChips } from "./modules-filter-menu";
import ModulesView from "./modules-view";
import { useModuleDisplay } from "./use-module-display";

type ModulesPageProps = {
  workspaceId: string;
  projectId: string;
  view: ModuleListView;
  query: string;
  onQueryChange: (query: string) => void;
  onViewChange: (view: ModuleListView) => void;
};

/** The Modules section: search, filters, display options and the list. */
export default function ModulesPage({
  workspaceId,
  projectId,
  view,
  query,
  onQueryChange,
  onViewChange,
}: ModulesPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreateModules, isCheckingPermissions } = useWorkspacePermission();
  const [display, updateDisplay] = useModuleDisplay(projectId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canCreate = !isCheckingPermissions && canCreateModules();
  const filtersActive = hasModuleFilters(display.filters);

  const clearFilters = () => {
    updateDisplay({ filters: EMPTY_MODULE_FILTERS });
    onQueryChange("");
  };

  // The top bar keeps the one primary action; search, filters, display
  // and the archived switch sit in the filter bar above the list.
  const headerActions = canCreate ? (
    <Button
      size="xs"
      className="gap-1"
      aria-label={t("modules:page.newModule")}
      onClick={() => setIsCreateOpen(true)}
    >
      <Plus className="size-3" />
      <TopBarLabel className="hidden sm:inline">
        {t("modules:page.newModule")}
      </TopBarLabel>
    </Button>
  ) : null;

  const filterBar = (
    <FilterBar
      trailing={
        <>
          <ModulesDisplayMenu display={display} onChange={updateDisplay} />
          <ToggleGroup
            size="sm"
            variant="outline"
            value={[view]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "active" || next === "archived") onViewChange(next);
            }}
          >
            <Toggle value="active" className="px-2 text-xs">
              {t("modules:page.viewActive")}
            </Toggle>
            <Toggle value="archived" className="px-2 text-xs">
              {t("modules:page.viewArchived")}
            </Toggle>
          </ToggleGroup>
        </>
      }
    >
      <div className="relative w-44 shrink-0 sm:w-56">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          maxLength={100}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("modules:page.searchPlaceholder")}
          aria-label={t("modules:page.searchPlaceholder")}
          className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
        />
      </div>
      <ModulesFilterMenu
        workspaceId={workspaceId}
        filters={display.filters}
        onChange={(filters) => updateDisplay({ filters })}
      />
      {filtersActive && (
        <>
          <ModulesFilterChips
            workspaceId={workspaceId}
            filters={display.filters}
            onChange={(filters) => updateDisplay({ filters })}
          />
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
            onClick={clearFilters}
          >
            {t("modules:filters.clear")}
          </Button>
        </>
      )}
    </FilterBar>
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="modules"
      headerActions={headerActions}
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${t("modules:page.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="modules"
      >
        <div className="flex h-full flex-col overflow-hidden">
          {filterBar}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ModulesView
              projectId={projectId}
              workspaceId={workspaceId}
              view={view}
              query={query}
              display={display}
              onClearFilters={clearFilters}
              onCreate={canCreate ? () => setIsCreateOpen(true) : undefined}
            />
          </div>
        </div>
        {canCreate && (
          <ModuleFormDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            projectId={projectId}
            workspaceId={workspaceId}
            onSaved={(module, created) => {
              if (!created) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId",
                params: { workspaceId, projectId, moduleId: module.id },
              });
            }}
          />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
