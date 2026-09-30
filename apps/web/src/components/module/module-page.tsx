import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import {
  PlanningLoadError,
  PlanningPageSkeleton,
} from "@/components/planning/planning-page-states";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import { useGetModule } from "@/hooks/queries/module/use-get-module";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { canEditModule } from "@/lib/module/status";
import ModuleBoardBody from "./module-board-body";
import ModuleCrumbSelect from "./module-crumb-select";
import ModuleHeaderActions from "./module-header-actions";
import { ModuleNotFound } from "./module-page-states";
import { useModuleBoard } from "./use-module-board";

type ModulePageProps = {
  workspaceId: string;
  projectId: string;
  moduleId: string;
  taskId?: string;
  panel?: "closed";
};

/** A module's page: the project board scoped to it, plus its details. */
export default function ModulePage({
  workspaceId,
  projectId,
  moduleId,
  taskId,
  panel,
}: ModulePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const enabled = isEnabled("modules");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const moduleQuery = useGetModule(projectId, enabled ? moduleId : "");
  // A module of another project is treated as missing here.
  const module =
    moduleQuery.data?.projectId === projectId ? moduleQuery.data : undefined;
  const board = useModuleBoard(projectId, moduleId, {
    enabled,
    archived: Boolean(module?.archivedAt),
  });
  const { canUpdateModules, canCreateTasks, isCheckingPermissions } =
    useWorkspacePermission();
  const [dialog, setDialog] = useState<"task" | "existing" | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useRecordVisit({
    workspaceId,
    entityType: "module",
    entityId: module ? moduleId : undefined,
    archived: visitArchiveState(module, project),
  });

  const isPanelOpen = panel !== "closed";
  const canUpdate = !isCheckingPermissions && canUpdateModules();
  const canAddExisting = Boolean(module && canEditModule(module) && canUpdate);
  const canAddTasks = canAddExisting && canCreateTasks();
  const isNotFound =
    Boolean(moduleQuery.data && !module) ||
    (moduleQuery.error instanceof HttpError &&
      [400, 403, 404].includes(moduleQuery.error.status));

  const goToList = useCallback(() => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/modules",
      params: { workspaceId, projectId },
    });
  }, [navigate, workspaceId, projectId]);

  const togglePanel = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          panel: isPanelOpen ? "closed" : undefined,
        }),
        replace: true,
      });
    } else {
      setIsSheetOpen((open) => !open);
    }
  };

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="modules"
      extraCrumbs={
        enabled ? (
          <ModuleCrumbSelect
            workspaceId={workspaceId}
            projectId={projectId}
            moduleId={moduleId}
            moduleName={module?.name}
            panel={panel}
          />
        ) : undefined
      }
      headerActions={
        module ? (
          <ModuleHeaderActions
            module={module}
            workspaceId={workspaceId}
            taskCount={board.taskCount}
            canAddTasks={canAddTasks}
            canAddExisting={canAddExisting}
            isPanelOpen={isPanelOpen}
            onAddTask={() => setDialog("task")}
            onAddExisting={() => setDialog("existing")}
            onTogglePanel={togglePanel}
            onDeleted={goToList}
          />
        ) : null
      }
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${module?.name ?? t("modules:nav.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="modules"
      >
        {module ? (
          <ModuleBoardBody
            module={module}
            workspaceId={workspaceId}
            taskId={taskId}
            board={board}
            canAddTasks={canAddTasks}
            canAddExisting={canAddExisting}
            canRestore={canUpdate}
            isPanelOpen={isPanelOpen}
            isSheetOpen={isSheetOpen}
            onSheetOpenChange={setIsSheetOpen}
            dialog={dialog}
            onDialogChange={setDialog}
          />
        ) : isNotFound ? (
          <ModuleNotFound workspaceId={workspaceId} projectId={projectId} />
        ) : moduleQuery.isError ? (
          <PlanningLoadError
            message={t("modules:toast.loadError")}
            onRetry={() => void moduleQuery.refetch()}
          />
        ) : (
          <PlanningPageSkeleton />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
