import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  Calendar,
  CalendarClock,
  CalendarX,
  GitMerge,
  GitPullRequest,
  SlidersHorizontal,
  SquareCheck,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecurringIndicator } from "@/components/task/recurring-indicator";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useGetCustomFieldValuesByProject from "@/hooks/queries/custom-field/use-get-custom-field-values-by-project";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { getExternalWebUrl, openExternalWebUrl } from "@/lib/external-url";
import { getTaskItemStats } from "@/lib/get-task-item-stats";
import { getPriorityIcon } from "@/lib/priority";
import { TaskPropertySlotOutlet } from "@/lib/task-property-slots";
import { toastTaskTrashed } from "@/lib/task-undo";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import AssigneeAvatarStack from "../task/assignee-avatar-stack";
import TaskCardContextMenuContent from "./task-card-context-menu/task-card-context-menu-content";
import { TaskLabels } from "./task-labels";

/** Faces on a card before the "+N" chip. */
const CARD_STACK_MAX = 2;

type TaskCardProps = {
  task: Task;
  disableDragDrop?: boolean;
  /** The copy held under the pointer while dragging (the drag overlay). */
  overlay?: boolean;
};

function TaskCard({
  task,
  disableDragDrop = false,
  overlay = false,
}: TaskCardProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    // The overlay copy must not register as the dragged card itself.
    id: overlay ? `overlay:${task.id}` : task.id,
    disabled: disableDragDrop || overlay,
  });
  const { project } = useProjectStore();
  const taskIsCompleted = isTaskCompleted(task.status, project?.columns);
  const { data: workspace } = useActiveWorkspace();
  const { mutateAsync: deleteTask } = useDeleteTask();
  const navigate = useNavigate();
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
    showTaskItemCounts,
  } = useUserPreferencesStore();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
  // Select the values: the React Compiler memoizes calls to the store's
  // stable getters, so the card would not update on selection.
  const toggleSelection = useBulkSelectionStore((s) => s.toggleSelection);
  const isTaskSelected = useBulkSelectionStore((s) =>
    s.selectedTaskIds.has(task.id),
  );
  const isTaskFocused = useBulkSelectionStore(
    (s) => s.focusedTaskId === task.id,
  );
  const taskItemStats = useMemo(
    () =>
      showTaskItemCounts && !task.descriptionDeferred
        ? getTaskItemStats(task.description)
        : null,
    [task.description, task.descriptionDeferred, showTaskItemCounts],
  );

  const pullRequests = useMemo(() => {
    return (task.externalLinks ?? []).filter(
      (link) =>
        link.resourceType === "pull_request" &&
        getExternalWebUrl(link.url) !== null,
    );
  }, [task.externalLinks]);

  const getPRInfo = (pr: (typeof pullRequests)[number]) => {
    const isMerged = pr.metadata?.merged === true;
    const isDraft = pr.metadata?.draft === true;

    if (isMerged) {
      return {
        icon: <GitMerge className="h-3 w-3 text-info-foreground" />,
        status: t("tasks:pr.merged"),
        statusClass: "text-info-foreground",
      };
    }

    if (isDraft) {
      return {
        icon: <GitPullRequest className="h-3 w-3 text-muted-foreground" />,
        status: t("tasks:pr.draft"),
        statusClass: "text-muted-foreground",
      };
    }

    return {
      icon: <GitPullRequest className="h-3 w-3 text-success-foreground" />,
      status: t("tasks:pr.open"),
      statusClass: "text-success-foreground",
    };
  };

  const { data: projectCustomFieldValues = [] } =
    useGetCustomFieldValuesByProject(task.projectId);

  const customFieldValues = useMemo(
    () =>
      projectCustomFieldValues
        .filter((field) => field.taskId === task.id)
        .sort((a, b) => a.fieldPosition - b.fieldPosition),
    [projectCustomFieldValues, task.id],
  );

  const activeCustomFieldValues = useMemo(
    () =>
      customFieldValues.filter(
        (field) => field.value !== null && field.value !== "",
      ),
    [customFieldValues],
  );

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition:
      transition || "transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    touchAction: isDragging ? "none" : "auto",
    zIndex: isDragging ? 999 : "auto",
  };

  const assignees = useTaskAssignees(task, workspace?.id ?? "");
  function handleTaskCardClick(
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (!project || !task || !workspace) return;

    if ((e as React.MouseEvent).metaKey || (e as React.KeyboardEvent).ctrlKey) {
      toggleSelection(task.id);
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    if (currentTaskId === task.id) {
      navigate({
        to: ".",
        search: {},
      });
    } else {
      navigate({
        to: ".",
        search: { taskId: task.id },
      });
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      toggleSelection(task.id);
    }
  };

  const handleDeleteTask = async () => {
    try {
      const deleted = await deleteTask(task.id);
      toastTaskTrashed(
        { taskId: deleted.id, projectId: deleted.projectId },
        { t },
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/** biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
          <div
            onClick={handleTaskCardClick}
            data-selected={isTaskSelected || undefined}
            data-dragging={isDragging || undefined}
            className={cn(
              "group relative rounded-lg border bg-background px-2.5 py-2 shadow-xs/5 transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98]",
              disableDragDrop ? "cursor-default" : "cursor-move",
              // In place of the dragged card: a neutral dashed slot.
              isDragging
                ? "border-foreground/25 border-dashed bg-muted/40 shadow-none *:invisible"
                : "hover:border-border/90 hover:shadow-sm",
              !isDragging &&
                (isTaskSelected
                  ? "border-ring/40 bg-accent/50 shadow-sm ring-1 ring-inset ring-ring/30"
                  : "border-border/80"),
              isTaskFocused && !isDragging && "ring-2 ring-inset ring-ring/50",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleTaskCardClick(e);
              } else if (e.key === "Escape") {
                handleKeyDown(e);
              }
            }}
          >
            {showTaskNumbers && (
              <div className="mb-1 font-mono text-[11px] text-muted-foreground leading-4">
                {project?.slug}-{task.number}
              </div>
            )}

            <div className="line-clamp-3 break-words font-medium text-[13px] text-foreground leading-[18px] [hyphens:auto]">
              {task.title}
            </div>

            {showLabels && (task.labels?.length ?? 0) > 0 && (
              <div className="mt-1.5">
                <TaskLabels labels={task.labels ?? []} />
              </div>
            )}

            <div className="mt-2 flex min-h-5 items-start gap-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {showPriority && (
                  <span className="inline-flex h-5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-1.5 font-medium text-[10px] text-muted-foreground">
                    {getPriorityIcon(task.priority ?? "")}
                  </span>
                )}

                {activeCustomFieldValues.length > 0 && (
                  <HoverCard openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground cursor-default focus:outline-none focus:ring-2 focus:ring-ring/50 focus:ring-offset-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        aria-label={t("tasks:customFields.ariaLabel", {
                          count: activeCustomFieldValues.length,
                        })}
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>{activeCustomFieldValues.length}</span>
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      className="w-fit p-2.5"
                      side="bottom"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-1.5">
                        {activeCustomFieldValues.map((field) => (
                          <div
                            key={field.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="font-medium text-muted-foreground truncate">
                              {field.fieldName}
                            </span>
                            <span className="text-foreground truncate max-w-24">
                              {field.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}

                {taskItemStats && taskItemStats.total > 0 && (
                  <span
                    className={cn(
                      "flex h-5 items-center gap-1 rounded bg-muted/50 px-1.5 text-[10px] text-muted-foreground",
                      {
                        "bg-success/10 text-success-foreground":
                          taskItemStats.completed === taskItemStats.total,
                      },
                    )}
                  >
                    <SquareCheck className="h-[12px] w-[12px]" />
                    {taskItemStats.completed}/{taskItemStats.total}
                  </span>
                )}

                {showDueDates && task.dueDate && (
                  <div
                    className={`flex h-5 items-center gap-1 rounded px-1.5 text-[10px] ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
                  >
                    {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                      "overdue" && <CalendarX className="w-3 h-3" />}
                    {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                      "due-soon" && <CalendarClock className="w-3 h-3" />}
                    {(getDueDateStatus(task.dueDate, taskIsCompleted) ===
                      "far-future" ||
                      getDueDateStatus(task.dueDate, taskIsCompleted) ===
                        "no-due-date") && <Calendar className="w-3 h-3" />}
                    <span>{format(new Date(task.dueDate), "MMM d")}</span>
                  </div>
                )}

                {task.isRecurring && <RecurringIndicator className="h-5" />}

                <TaskPropertySlotOutlet
                  location="cardChip"
                  projectId={task.projectId}
                  workspaceId={workspace?.id ?? ""}
                  props={{ task }}
                />

                {pullRequests.length === 1 && (
                  <HoverCard openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternalWebUrl(pullRequests[0].url);
                        }}
                        className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                      >
                        {getPRInfo(pullRequests[0]).icon}
                        <span>#{pullRequests[0].externalId}</span>
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      className="w-72 p-3"
                      side="bottom"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {getPRInfo(pullRequests[0]).icon}
                          <span>{getPRInfo(pullRequests[0]).status}</span>
                          <span className="text-muted-foreground/50">•</span>
                          <span>#{pullRequests[0].externalId}</span>
                        </div>
                        <p className="text-sm font-medium leading-snug">
                          {pullRequests[0].title || t("tasks:pr.label")}
                        </p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}

                {pullRequests.length > 1 &&
                  (() => {
                    const hasOpen = pullRequests.some(
                      (pr) => !pr.metadata?.merged && !pr.metadata?.draft,
                    );
                    const allMerged = pullRequests.every(
                      (pr) => pr.metadata?.merged,
                    );
                    const iconColor = allMerged
                      ? "text-info-foreground"
                      : hasOpen
                        ? "text-success-foreground"
                        : "text-muted-foreground";

                    return (
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                          >
                            <GitPullRequest
                              className={`h-3 w-3 ${iconColor}`}
                            />
                            <span>
                              {t("tasks:pr.count", {
                                count: pullRequests.length,
                              })}
                            </span>
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent
                          className="w-auto min-w-56 max-w-96 p-1"
                          side="bottom"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {pullRequests.map((pr, index) => {
                            const prInfo = getPRInfo(pr);
                            const repoMatch = pr.url.match(
                              /github\.com\/([^/]+\/[^/]+)\/pull/,
                            );
                            const repoName = repoMatch ? repoMatch[1] : null;
                            return (
                              <div key={pr.id}>
                                {index > 0 && (
                                  <hr className="border-border my-1" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => openExternalWebUrl(pr.url)}
                                  className="w-full px-2 py-1.5 text-left hover:bg-muted/50 rounded transition-colors"
                                >
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    {prInfo.icon}
                                    <span>
                                      {repoName}#{pr.externalId}
                                    </span>
                                  </div>
                                  <p className="text-xs leading-tight line-clamp-2 mt-0.5">
                                    {pr.title || t("tasks:pr.label")}
                                  </p>
                                  <span className="text-[10px] text-muted-foreground">
                                    {prInfo.status}
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })()}
              </div>
              {showAssignees && (
                <div className="ms-auto flex shrink-0">
                  <AssigneeAvatarStack
                    assignees={assignees}
                    max={CARD_STACK_MAX}
                    size="sm"
                    ring="background"
                    showEmpty
                  />
                </div>
              )}
            </div>
          </div>
        </ContextMenuTrigger>

        {project && workspace && (
          <TaskCardContextMenuContent
            task={task}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspace.id,
            }}
            onDeleteClick={() => setIsDeleteTaskModalOpen(true)}
          />
        )}
      </ContextMenu>

      <AlertDialog
        open={isDeleteTaskModalOpen}
        onOpenChange={setIsDeleteTaskModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteTask}
                />
              }
            >
              {t("tasks:delete.action")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TaskCard;
