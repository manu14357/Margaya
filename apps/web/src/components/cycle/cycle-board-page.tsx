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
import { useGetCycle } from "@/hooks/queries/cycle/use-get-cycle";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { canEditCycle } from "@/lib/cycle/status";
import { HttpError } from "@/lib/http-error";
import CycleBoardBody from "./cycle-board-body";
import CycleCrumbSelect from "./cycle-crumb-select";
import CycleHeaderActions from "./cycle-header-actions";
import { CycleNotFound } from "./cycle-page-states";
import CyclePlanner from "./cycle-planner";
import { useCycleBoard } from "./use-cycle-board";

type CycleBoardPageProps = {
  workspaceId: string;
  projectId: string;
  cycleId: string;
  taskId?: string;
  panel?: "closed";
  mode?: "plan";
};

/**
 * A cycle's page: the project board scoped to it, plus its progress; or,
 * in plan mode, the split-view planner (backlog beside the cycle).
 */
export default function CycleBoardPage({
  workspaceId,
  projectId,
  cycleId,
  taskId,
  panel,
  mode,
}: CycleBoardPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const enabled = isEnabled("cycles");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const cycleQuery = useGetCycle(projectId, enabled ? cycleId : "");
  const cycle = cycleQuery.data;
  const board = useCycleBoard(projectId, cycleId);
  const { canUpdateCycles, canCreateTasks } = useWorkspacePermission();
  const [dialog, setDialog] = useState<"task" | "existing" | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useRecordVisit({
    workspaceId,
    entityType: "cycle",
    entityId: enabled ? cycleId : undefined,
    archived: visitArchiveState(cycle, project),
  });

  const isPanelOpen = panel !== "closed";
  const canAddTasks = Boolean(
    cycle && canEditCycle(cycle) && canUpdateCycles() && canCreateTasks(),
  );
  const canPlan = Boolean(cycle && canEditCycle(cycle) && canUpdateCycles());
  const isPlanning = mode === "plan" && canPlan;
  const isNotFound =
    cycleQuery.error instanceof HttpError &&
    (cycleQuery.error.status === 404 || cycleQuery.error.status === 403);

  const goToList = useCallback(() => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/cycles",
      params: { workspaceId, projectId },
    });
  }, [navigate, workspaceId, projectId]);

  const setPlanning = (planning: boolean) =>
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        mode: planning ? "plan" : undefined,
      }),
      replace: true,
    });

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
      activeSection="cycles"
      extraCrumbs={
        enabled ? (
          <CycleCrumbSelect
            workspaceId={workspaceId}
            projectId={projectId}
            cycleId={cycleId}
            cycleName={cycle?.name}
            panel={panel}
          />
        ) : undefined
      }
      headerActions={
        cycle ? (
          <CycleHeaderActions
            cycle={cycle}
            workspaceId={workspaceId}
            taskCount={board.taskCount}
            canAddTasks={canAddTasks}
            canPlan={canPlan}
            isPlanning={isPlanning}
            onTogglePlanning={() => setPlanning(!isPlanning)}
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
        title={`${project?.name ?? ""} · ${cycle?.name ?? t("cycles:nav.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="cycles"
      >
        {cycle && isPlanning ? (
          <CyclePlanner cycle={cycle} workspaceId={workspaceId} />
        ) : cycle ? (
          <CycleBoardBody
            cycle={cycle}
            workspaceId={workspaceId}
            taskId={taskId}
            board={board}
            canAddTasks={canAddTasks}
            isPanelOpen={isPanelOpen}
            isSheetOpen={isSheetOpen}
            onSheetOpenChange={setIsSheetOpen}
            dialog={dialog}
            onDialogChange={setDialog}
            onPlan={canPlan ? () => setPlanning(true) : undefined}
          />
        ) : isNotFound ? (
          <CycleNotFound workspaceId={workspaceId} projectId={projectId} />
        ) : cycleQuery.isError ? (
          <PlanningLoadError
            message={t("cycles:toast.loadError")}
            onRetry={() => void cycleQuery.refetch()}
          />
        ) : (
          <PlanningPageSkeleton />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
