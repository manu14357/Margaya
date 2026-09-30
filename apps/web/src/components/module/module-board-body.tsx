import { useNavigate } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { useCallback } from "react";
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
import { useArchiveModule } from "@/hooks/mutations/module/use-archive-module";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ModuleDetail } from "@/types/module";
import AddExistingModuleTasksDialog from "./add-existing-module-tasks-dialog";
import { ModuleEmptyBoard } from "./module-page-states";
import { ModuleScopeProvider } from "./module-scope-context";
import ModuleSidebar from "./module-sidebar";
import type { useModuleBoard } from "./use-module-board";

type ModuleBoardBodyProps = {
  module: ModuleDetail;
  workspaceId: string;
  taskId?: string;
  board: ReturnType<typeof useModuleBoard>;
  canAddTasks: boolean;
  canAddExisting: boolean;
  canRestore: boolean;
  isPanelOpen: boolean;
  isSheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  dialog: "task" | "existing" | null;
  onDialogChange: (dialog: "task" | "existing" | null) => void;
};

/** The toolbar, archive notice, scoped board or list, and the sidebar. */
export default function ModuleBoardBody({
  module,
  workspaceId,
  taskId,
  board,
  canAddTasks,
  canAddExisting,
  canRestore,
  isPanelOpen,
  isSheetOpen,
  onSheetOpenChange,
  dialog,
  onDialogChange,
}: ModuleBoardBodyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = module.projectId;
  const { viewMode, setViewMode } = useUserPreferencesStore();
  const restore = useArchiveModule();

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
    moduleTaskIds,
    taskCount,
    queryState,
    sort,
    filterStatus,
    isPendingFilter,
    planningControls,
  } = board;

  const isArchived = Boolean(module.archivedAt);

  const handleRestore = () =>
    restore.mutate(
      { moduleId: module.id, projectId, archive: false },
      {
        onSuccess: () => toast.success(t("modules:toast.restored")),
        onError: (error) =>
          toast.error(error.message || t("modules:toast.restoreError")),
      },
    );

  const sidebar = project ? (
    <ModuleSidebar
      module={module}
      workspaceId={workspaceId}
      {...planningControls}
      columns={project.columns}
    />
  ) : null;

  return (
    <ModuleScopeProvider moduleId={module.id} projectId={projectId}>
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
            hiddenSubjects={["module"]}
          />

          {isArchived && (
            <Alert className="m-3 mb-0 w-auto">
              <Archive />
              <AlertDescription>
                {t("modules:detail.archivedNotice")}
              </AlertDescription>
              {canRestore && (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    loading={restore.isPending}
                    onClick={handleRestore}
                  >
                    {t("modules:actions.restore")}
                  </Button>
                </AlertAction>
              )}
            </Alert>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
            {!sortedProject || isPendingFilter ? (
              <PlanningPageSkeleton />
            ) : taskCount === 0 ? (
              <ModuleEmptyBoard
                isArchived={isArchived}
                onCreateTask={
                  canAddTasks ? () => onDialogChange("task") : undefined
                }
                onAddExisting={
                  canAddExisting ? () => onDialogChange("existing") : undefined
                }
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
            aria-label={t("modules:sidebar.title")}
            className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card lg:block"
          >
            {sidebar}
          </aside>
        )}
      </div>

      <Sheet open={isSheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent side="right" className="overflow-y-auto p-0 lg:hidden">
          <SheetTitle className="sr-only">
            {t("modules:sidebar.title")}
          </SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <CreateTaskModal
        open={dialog === "task"}
        projectId={projectId}
        onClose={() => onDialogChange(null)}
      />
      {canAddExisting && (
        <AddExistingModuleTasksDialog
          module={module}
          moduleTaskIds={moduleTaskIds}
          open={dialog === "existing"}
          onOpenChange={(open) => onDialogChange(open ? "existing" : null)}
        />
      )}
      <TaskDetailsSheet
        taskId={taskId}
        projectId={projectId}
        workspaceId={workspaceId}
        onClose={closeTaskSheet}
      />
    </ModuleScopeProvider>
  );
}
