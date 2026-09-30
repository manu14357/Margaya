import { Archive, Boxes, Plus, SearchX } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CollapsibleSection,
  PlanningRowSkeletons,
} from "@/components/planning/collapsible-section";
import { PlanningLoadError } from "@/components/planning/planning-page-states";
import {
  isBooleanRecord,
  useStoredState,
} from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  filterModules,
  type ModuleDisplaySettings,
  type ModuleLayout,
  sortModules,
} from "@/lib/module/display";
import { MODULE_STATUS_META, MODULE_STATUS_ORDER } from "@/lib/module/status";
import { toast } from "@/lib/toast";
import type { Module, ModuleListView } from "@/types/module";
import ModuleCard from "./module-card";
import ModuleRow from "./module-row";
import SortableModules from "./sortable-modules";

type ModulesViewProps = {
  projectId: string;
  workspaceId: string;
  view: ModuleListView;
  query: string;
  display: ModuleDisplaySettings;
  /** Clears the filters and the search. */
  onClearFilters: () => void;
  /** Present when the user may create modules. */
  onCreate?: () => void;
};

function ModuleItems({
  modules,
  layout,
  workspaceId,
}: {
  modules: Module[];
  layout: ModuleLayout;
  workspaceId: string;
}) {
  if (layout === "gallery") {
    return (
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => (
          <ModuleCard
            key={module.id}
            module={module}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/50">
      {modules.map((module) => (
        <ModuleRow key={module.id} module={module} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

function ModulesSkeleton({ layout }: { layout: ModuleLayout }) {
  if (layout === "gallery") {
    return (
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {["a", "b", "c", "d", "e", "f"].map((key) => (
          <Skeleton key={key} className="h-36 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  return <PlanningRowSkeletons count={5} />;
}

/** The project's modules as a list or gallery, grouped by status or not. */
export default function ModulesView({
  projectId,
  workspaceId,
  view,
  query,
  display,
  onClearFilters,
  onCreate,
}: ModulesViewProps) {
  const { t } = useTranslation();
  const isArchived = view === "archived";
  const { data, isLoading, isError, refetch } = useGetModules(projectId, view);
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const [openSections, setOpenSections] = useStoredState<
    Record<string, boolean>
  >(`margaya:module-sections:${projectId}`, {}, isBooleanRecord);

  useEffect(() => {
    if (isError) toast.error(t("modules:toast.loadError"));
  }, [isError, t]);

  if (isError) {
    return (
      <PlanningLoadError
        message={t("modules:toast.loadError")}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading || !data) return <ModulesSkeleton layout={display.layout} />;

  if (data.length === 0) {
    return (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {isArchived ? <Archive /> : <Boxes />}
          </EmptyMedia>
          <EmptyTitle>
            {isArchived
              ? t("modules:empty.archivedTitle")
              : t("modules:empty.title")}
          </EmptyTitle>
          <EmptyDescription>
            {isArchived
              ? t("modules:empty.archivedDescription")
              : t("modules:empty.description")}
          </EmptyDescription>
        </EmptyHeader>
        {!isArchived && onCreate && (
          <EmptyContent>
            <Button onClick={onCreate}>
              <Plus />
              {t("modules:page.newModule")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const visible = sortModules(
    filterModules(data, display.filters, query),
    display.order,
  );

  if (visible.length === 0) {
    return (
      <Empty className="min-h-[40vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>{t("modules:empty.filteredTitle")}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            {t("modules:filters.clear")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!display.groupByStatus) {
    const canReorder =
      display.order === "manual" &&
      !isArchived &&
      !isCheckingPermissions &&
      canUpdateModules();
    return canReorder ? (
      <SortableModules
        projectId={projectId}
        modules={visible}
        layout={display.layout}
        renderModule={(module, handle) =>
          display.layout === "gallery" ? (
            <ModuleCard
              module={module}
              workspaceId={workspaceId}
              handle={handle}
              className="h-full"
            />
          ) : (
            <ModuleRow
              module={module}
              workspaceId={workspaceId}
              handle={handle}
            />
          )
        }
      />
    ) : (
      <ModuleItems
        modules={visible}
        layout={display.layout}
        workspaceId={workspaceId}
      />
    );
  }

  return (
    <div>
      {MODULE_STATUS_ORDER.map((status) => {
        const modules = visible.filter((module) => module.status === status);
        if (modules.length === 0) return null;
        const meta = MODULE_STATUS_META[status];
        const open = openSections[status] ?? true;
        return (
          <CollapsibleSection
            key={status}
            title={t(meta.labelKey)}
            icon={meta.icon}
            count={modules.length}
            open={open}
            onToggle={() =>
              setOpenSections({ ...openSections, [status]: !open })
            }
          >
            <ModuleItems
              modules={modules}
              layout={display.layout}
              workspaceId={workspaceId}
            />
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
