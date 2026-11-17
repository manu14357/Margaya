import { useLocation, useNavigate } from "@tanstack/react-router";
import { SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DesktopTaskOfflineSnapshot } from "@/components/desktop/desktop-offline-snapshot";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  SHEET_HEADER_PANEL_GROUP,
  type SheetHeaderAction,
  SheetHeaderBar,
  type SheetHeaderMenu,
} from "@/components/ui/sheet-header-bar";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { ProjectScope } from "@/hooks/use-project-scope";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import TaskActionsMenu from "./task-actions-menu";
import TaskDeleteButton from "./task-delete-button";
import TaskDetailsContent from "./task-details-content";
import TaskKeyCopyButton from "./task-key-copy-button";
import { TaskDetailsSkeleton } from "./task-page-skeleton";
import TaskPropertiesSidebar from "./task-properties-sidebar";
import TaskSurfaceShortcuts from "./task-shortcuts/task-surface-shortcuts";
import TaskStatusChip from "./task-status-chip";
import TaskStepper from "./task-stepper";
import TaskSubscribeButton, {
  useTaskSubscriptionToggle,
} from "./task-subscribe-button";

type TaskDetailsSheetProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
};

/**
 * The task as a right sheet (560px; full screen below 768px) over the
 * current view. Header (SheetHeaderBar): key and status; previous/next with
 * "N of M"; watch and more | delete | "Open in full page" and close panel.
 * In the desktop shell the key and status share the title row with the
 * window buttons and the toolbar sits under it; on narrow panels delete,
 * then "Open in full page", then watch move into "…". Body: the task, with
 * the property grid after the description.
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
    // The sheet acts in its task's project, whatever view opened it.
    <ProjectScope projectId={task?.projectId ?? projectId}>
      <DesktopTaskOfflineSnapshot
        task={taskId && task?.id === currentTaskId ? task : undefined}
        workspaceId={workspaceId}
      />
      <Sheet open={!!taskId} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          aria-label={t("tasks:detail.sheetLabel")}
          className="w-full max-w-full gap-0 p-0 md:max-w-[560px]"
        >
          <TaskSheetHeader
            taskId={currentTaskId}
            projectId={projectId}
            workspaceId={workspaceId}
            onStep={handleStep}
            onOpenFullPage={handleOpenFullPage}
            onDeleted={onClose}
          />

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
    </ProjectScope>
  );
}

/**
 * The sheet's header, inside the task's project scope so the delete
 * permission is the project's (restricted projects included).
 */
function TaskSheetHeader({
  taskId,
  projectId,
  workspaceId,
  onStep,
  onOpenFullPage,
  onDeleted,
}: {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  onStep: (taskId: string) => void;
  onOpenFullPage: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { data: task } = useGetTask(taskId ?? "");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canDeleteTasks, isCheckingPermissions } = useWorkspacePermission();
  const canDelete = !isCheckingPermissions && canDeleteTasks();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const subscription = useTaskSubscriptionToggle(taskId);

  const openFullPageLabel = t("tasks:detail.openInFullPage");
  const deleteLabel = t("tasks:delete.action");
  const headerActions: (SheetHeaderAction | SheetHeaderMenu)[] = [];
  if (taskId) {
    if (subscription) {
      const WatchIcon = subscription.icon;
      headerActions.push({
        id: "watch",
        label: subscription.label,
        icon: <WatchIcon className="size-4" />,
        onSelect: subscription.toggle,
        render: <TaskSubscribeButton taskId={taskId} size="icon" />,
        priority: 3,
      });
    }
    headerActions.push({
      id: "more",
      menu: (collapsed) => (
        <>
          <TaskActionsMenu
            taskId={taskId}
            projectId={projectId}
            workspaceId={workspaceId}
            extraItems={collapsed}
            triggerSize="icon-sm"
          />
          {canDelete && collapsed.some((item) => item.id === "delete") && (
            // Delete lives in "…" now: its confirm, and a target for the
            // delete shortcut, stay mounted here.
            <span data-task-delete="" hidden>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setDeleteOpen(true)}
              />
              <TaskDeleteButton
                taskId={taskId}
                onDeleted={onDeleted}
                showTrigger={false}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
              />
            </span>
          )}
        </>
      ),
    });
    if (canDelete) {
      headerActions.push({
        id: "delete",
        group: "danger",
        label: deleteLabel,
        icon: <Trash2 className="size-4" />,
        onSelect: () => setDeleteOpen(true),
        destructive: true,
        render: (
          <span data-task-delete="" className="contents">
            <TaskDeleteButton
              taskId={taskId}
              onDeleted={onDeleted}
              iconOnly
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          </span>
        ),
        priority: 1,
      });
    }
    headerActions.push({
      id: "full-page",
      group: SHEET_HEADER_PANEL_GROUP,
      label: openFullPageLabel,
      icon: <SquareArrowOutUpRight className="size-4" />,
      onSelect: onOpenFullPage,
      priority: 2,
    });
  }

  return (
    <SheetHeaderBar
      identity={
        <>
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
        </>
      }
      navigation={
        <TaskStepper
          projectId={projectId}
          taskId={taskId}
          onNavigate={onStep}
        />
      }
      actions={headerActions}
    />
  );
}
