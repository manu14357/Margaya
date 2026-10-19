import { useNavigate } from "@tanstack/react-router";
import { Archive, ArrowRightLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import BoardToolbar from "@/components/board/board-toolbar";
import KanbanBoard from "@/components/kanban-board";
import ListView from "@/components/list-view";
import { PlanningPageSkeleton } from "@/components/planning/planning-page-states";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { canEditCycle, canTransfer } from "@/lib/cycle/status";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { Cycle } from "@/types/cycle";
import AddExistingTasksDialog from "./add-existing-tasks-dialog";
import { CycleEmptyBoard } from "./cycle-page-states";
import { CycleScopeProvider } from "./cycle-scope-context";
import CycleSidebar from "./cycle-sidebar";
import TransferTasksDialog from "./transfer-tasks-dialog";
import type { useCycleBoard } from "./use-cycle-board";

type CycleBoardBodyProps = {
  cycle: Cycle;
  workspaceId: string;
  taskId?: string;
  board: ReturnType<typeof useCycleBoard>;
  canAddTasks: boolean;
  isPanelOpen: boolean;
  isSheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  dialog: "task" | "existing" | null;
  onDialogChange: (dialog: "task" | "existing" | null) => void;
  /** Opens the split-view planner; absent when the cycle can't be planned. */
  onPlan?: () => void;
};

/** The toolbar, banners, scoped board or list, and the progress sidebar. */
export default function CycleBoardBody({
  cycle,
  workspaceId,
  taskId,
  board,
  canAddTasks,
  isPanelOpen,
  isSheetOpen,
  onSheetOpenChange,
  dialog,
  onDialogChange,
  onPlan,
}: CycleBoardBodyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = cycle.projectId;
  const { viewMode, setViewMode } = useUserPreferencesStore();
  const { canUpdateCycles } = useWorkspacePermission();
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  const closeTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const {
    project,
    sortedProject,
    taskCount,
    queryState,
    sort,
    filterStatus,
    isPendingFilter,
    planningControls,
  } = board;

  const isClosed = !canEditCycle(cycle);
  const showTransfer = canUpdateCycles() && canTransfer(cycle);
  const sidebar = project ? (
    <CycleSidebar
      cycle={cycle}
      workspaceId={workspaceId}
      {...planningControls}
      columns={project.columns}
    />
  ) : null;

  return (
    <CycleScopeProvider cycleId={cycle.id} projectId={projectId}>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <BoardToolbar
            workspaceId={workspaceId}
            projectId={projectId}
            handle={queryState}
            viewMode={viewMode}
            setViewMode={setViewMode}
            status={filterStatus}
            classicOnly
            hiddenSubjects={["cycle"]}
          />

          {showTransfer && (
            <Alert variant="warning" className="m-3 mb-0 w-auto">
              <ArrowRightLeft />
              <AlertDescription>
                {t("cycles:detail.transferBanner", { count: cycle.pending })}
              </AlertDescription>
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setIsTransferOpen(true)}
                >
                  {t("cycles:detail.transferAction")}
                </Button>
              </AlertAction>
            </Alert>
          )}
          {cycle.archivedAt && (
            <Alert className="m-3 mb-0 w-auto">
              <Archive />
              <AlertDescription>
                {t("cycles:detail.archivedNotice")}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
            {!sortedProject || isPendingFilter ? (
              <PlanningPageSkeleton />
            ) : taskCount === 0 ? (
              <CycleEmptyBoard
                isClosed={isClosed}
                onCreateTask={
                  canAddTasks ? () => onDialogChange("task") : undefined
                }
                onAddExisting={
                  canAddTasks ? () => onDialogChange("existing") : undefined
                }
                onPlan={onPlan}
              />
            ) : viewMode === "board" ? (
              <KanbanBoard
                project={sortedProject}
                disableDragDrop={sort.field !== "position"}
              />
            ) : (
              <ListView
                project={sortedProject}
                disableDragDrop={sort.field !== "position"}
              />
            )}
          </div>
        </div>

        {isPanelOpen && (
          <aside
            aria-label={t("cycles:sidebar.title")}
            className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card lg:block"
          >
            {sidebar}
          </aside>
        )}
      </div>

      <Sheet open={isSheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent side="right" className="overflow-y-auto p-0 lg:hidden">
          <SheetTitle className="sr-only">
            {t("cycles:sidebar.title")}
          </SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <CreateTaskModal
        open={dialog === "task"}
        projectId={projectId}
        onClose={() => onDialogChange(null)}
      />
      <AddExistingTasksDialog
        cycle={cycle}
        open={dialog === "existing"}
        onOpenChange={(open) => onDialogChange(open ? "existing" : null)}
      />
      {showTransfer && (
        <TransferTasksDialog
          cycle={cycle}
          workspaceId={workspaceId}
          open={isTransferOpen}
          onOpenChange={setIsTransferOpen}
        />
      )}
      <TaskDetailsSheet
        taskId={taskId}
        projectId={projectId}
        workspaceId={workspaceId}
        onClose={closeTaskSheet}
      />
    </CycleScopeProvider>
  );
}
