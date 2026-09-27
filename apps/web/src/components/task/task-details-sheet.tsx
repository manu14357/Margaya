import { useLocation, useNavigate } from "@tanstack/react-router";
import { Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import TaskActionsMenu from "./task-actions-menu";
import TaskDeleteButton from "./task-delete-button";
import TaskDetailsContent from "./task-details-content";
import TaskKeyCopyButton from "./task-key-copy-button";
import { TaskDetailsSkeleton } from "./task-page-skeleton";
import TaskPropertiesSidebar from "./task-properties-sidebar";
import TaskSurfaceShortcuts from "./task-shortcuts/task-surface-shortcuts";
import TaskStatusChip from "./task-status-chip";
import TaskStepper from "./task-stepper";
import TaskSubscribeButton from "./task-subscribe-button";

type TaskDetailsSheetProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
};

/**
 * The task as a right sheet (560px; full screen below 768px) over the
 * current view. Header: key, status, previous/next, subscribe, more,
 * delete, "Open in full page" and close. Body: the task, with the property
 * grid after the description.
 */
export default function TaskDetailsSheet({
  taskId,
  projectId,
  workspaceId,
  onClose,
}: TaskDetailsSheetProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useLocation({
    select: (location) => location.search as Record<string, unknown>,
  });
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>(
    taskId,
  );

  const { data: task, isError: isTaskError } = useGetTask(currentTaskId ?? "");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  useRecordVisit({
    workspaceId,
    entityType: "task",
    entityId: currentTaskId,
    // The loaded task must be the one shown; a task of an archived project
    // counts as archived too.
    archived: visitArchiveState(
      task?.id === currentTaskId ? task : undefined,
      project,
    ),
  });

  useEffect(() => {
    if (taskId) {
      // Update taskId immediately without closing/reopening
      setCurrentTaskId(taskId);
    } else {
      // Delay clearing to allow exit animation
      const timer = setTimeout(() => {
        setCurrentTaskId(undefined);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [taskId]);

  const handleOpenFullPage = useCallback(() => {
    if (!currentTaskId) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId,
        projectId: task?.projectId ?? projectId,
        taskId: currentTaskId,
      },
    });
  }, [navigate, workspaceId, projectId, currentTaskId, task?.projectId]);

  // Views that keep the open task in `?taskId=` follow along, so a reload
  // or a shared link opens the task the user stepped to.
  const handleStep = useCallback(
    (nextTaskId: string) => {
      if (search.taskId === taskId) {
        navigate({
          to: ".",
          search: ((previous: Record<string, unknown>) => ({
            ...previous,
            taskId: nextTaskId,
          })) as never,
          replace: true,
        });
      }
      setCurrentTaskId(nextTaskId);
    },
    [navigate, search.taskId, taskId],
  );

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        aria-label={t("tasks:detail.sheetLabel")}
        className="w-full max-w-full gap-0 p-0 md:max-w-[560px] [&>button]:hidden"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TaskKeyCopyButton
              slug={project?.slug}
              number={task?.number}
              className="shrink-0 font-medium font-mono text-muted-foreground text-xs"
            />
            {task && (
              <TaskStatusChip
                status={task.status}
                projectId={task.projectId ?? projectId}
              />
            )}
            <TaskStepper
              projectId={projectId}
              taskId={currentTaskId}
              onNavigate={handleStep}
              className="ml-1"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <TaskSubscribeButton taskId={currentTaskId} size="icon" />
            {currentTaskId && (
              <TaskActionsMenu
                taskId={currentTaskId}
                projectId={projectId}
                workspaceId={workspaceId}
              />
            )}
            {currentTaskId && (
              <span data-task-delete="" className="contents">
                <TaskDeleteButton
                  taskId={currentTaskId}
                  onDeleted={onClose}
                  iconOnly
                />
              </span>
            )}
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleOpenFullPage}
                    className="text-foreground"
                    aria-label={t("tasks:detail.openInFullPage")}
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("tasks:detail.openInFullPage")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-foreground"
              aria-label={t("common:actions.close")}
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <TaskSurfaceShortcuts
          taskId={taskId ? currentTaskId : undefined}
          projectId={projectId}
          workspaceId={workspaceId}
        />
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          key={currentTaskId}
          data-task-surface=""
        >
          {/* Until the task loads (opening, or stepping to an uncached
              one) the skeleton stands in, not an empty, editable form. */}
          {currentTaskId && !isTaskError && task?.id !== currentTaskId ? (
            <TaskDetailsSkeleton className="px-5 pt-4 pb-10" />
          ) : (
            <TaskDetailsContent
              taskId={currentTaskId}
              projectId={projectId}
              workspaceId={workspaceId}
              showKey={false}
              className="px-5 pt-4 pb-10"
              properties={
                <TaskPropertiesSidebar
                  taskId={currentTaskId}
                  projectId={projectId}
                  workspaceId={workspaceId}
                  className="rounded-lg border border-border bg-sidebar/40"
                  compact
                />
              }
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
