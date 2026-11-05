import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import {
  Calendar,
  CalendarClock,
  CalendarX,
  GitMerge,
  GitPullRequest,
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { getExternalWebUrl, openExternalWebUrl } from "@/lib/external-url";
import { formatDateShort } from "@/lib/format";
import { TaskPropertySlotOutlet } from "@/lib/task-property-slots";
import { toastTaskTrashed } from "@/lib/task-undo";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import { SelectionCheckbox } from "../bulk-selection/selection-checkbox";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { LabelChips } from "../shared/label-chips";
import AssigneeAvatarStack from "../task/assignee-avatar-stack";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";
import {
  AssigneeTrigger,
  PriorityTrigger,
  StatusTrigger,
} from "./triage-triggers";

type TaskRowProps = {
  task: Task;
  projectSlug: string;
  /** The colour the board gives the task's column. */
  statusHue?: string;
  /** Offers the selection control; Ctrl or ⌘ click selects regardless. */
  selectable?: boolean;
};

function TaskRow({
  task,
  projectSlug,
  statusHue,
  selectable = true,
}: TaskRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const { project } = useProjectStore();
  const taskIsCompleted = isTaskCompleted(task.status, project?.columns);
  const column = project?.columns?.find(
    (candidate) => candidate.slug === task.status,
  );
  const { data: workspace } = useActiveWorkspace();
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
  } = useUserPreferencesStore();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
  const { mutateAsync: deleteTask } = useDeleteTask();
  // Select the values: the React Compiler memoizes calls to the store's
  // stable getters, so the row would not update on selection.
  const toggleSelection = useBulkSelectionStore((s) => s.toggleSelection);
  const isTaskSelected = useBulkSelectionStore((s) =>
    s.selectedTaskIds.has(task.id),
  );
  const isTaskFocused = useBulkSelectionStore(
    (s) => s.focusedTaskId === task.id,
  );
  const selectionActive = useBulkSelectionStore(
    (s) => s.selectedTaskIds.size > 0,
  );

  const assignees = useTaskAssignees(task, workspace?.id ?? "");

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

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)",
    touchAction: isDragging ? "none" : "auto",
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!project || !task) return;
    if (e.defaultPrevented) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
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
  };

  // Keys on the controls inside belong to them. Enter opens the row, which
  // leaves Space to pick it up for a keyboard drag.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" && !isDragging) {
      handleClick(e as unknown as React.MouseEvent);
      e.preventDefault();
      return;
    }
    listeners?.onKeyDown?.(e);
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
    <div
      ref={setNodeRef}
      style={style}
      data-selected={isTaskSelected || undefined}
      data-task-row={task.id}
      data-focused={isTaskFocused || undefined}
      className={cn(
        "relative border-border/50 border-b transition-colors duration-150",
        isDragging && "opacity-50",
        isTaskSelected &&
          "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:bg-primary",
        isTaskFocused && "ring-2 ring-inset ring-ring/50",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
          <div
            onClick={handleClick}
            className={cn(
              "group/selectable group relative flex min-h-9 cursor-pointer items-center gap-1.5 px-2 py-0.5 transition-colors md:gap-2 md:px-3",
              isTaskSelected
                ? "bg-accent/45"
                : "hover:bg-accent/70 hover:shadow-[inset_2px_0_0_var(--primary)]",
            )}
            {...attributes}
            {...listeners}
            onKeyDown={handleKeyDown}
          >
            {selectable && (
              <SelectionCheckbox
                title={task.title}
                checked={isTaskSelected}
                selectionActive={selectionActive}
                onToggle={() => toggleSelection(task.id)}
              />
            )}
            {showPriority && <PriorityTrigger task={task} />}
            {showTaskNumbers && (
              <div className="w-16 shrink-0 truncate font-mono text-muted-foreground text-xs">
                {projectSlug}-{task.number}
              </div>
            )}
            <StatusTrigger task={task} column={column} hue={statusHue} />

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-[13px] text-foreground">
                  {task.title}
                </span>
                <div className="hidden items-center gap-1 sm:flex">
                  {showLabels && (
                    <LabelChips labels={task.labels ?? []} max={3} />
                  )}

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
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-sidebar text-[10px] font-medium text-muted-foreground"
                        >
                          {getPRInfo(pullRequests[0]).icon}
                          <span>#{pullRequests[0].externalId}</span>
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent
                        className="w-72 p-3"
                        side="bottom"
                        onClick={(e) => e.stopPropagation()}
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
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-sidebar text-[10px] font-medium text-muted-foreground"
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
              </div>
            </div>

            {showDueDates && task.dueDate && (
              <div
                className={`flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 font-medium text-[10px] ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
              >
                {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                  "overdue" && <CalendarX className="w-3 h-3" />}
                {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                  "due-soon" && <CalendarClock className="w-3 h-3" />}
                {(getDueDateStatus(task.dueDate, taskIsCompleted) ===
                  "far-future" ||
                  getDueDateStatus(task.dueDate, taskIsCompleted) ===
                    "no-due-date") && <Calendar className="w-3 h-3" />}
                <span>{formatDateShort(new Date(task.dueDate))}</span>
              </div>
            )}

            {task.isRecurring && <RecurringIndicator />}

            {showAssignees && (
              <AssigneeTrigger task={task} workspaceId={workspace?.id ?? ""}>
                <AssigneeAvatarStack
                  assignees={assignees}
                  max={2}
                  size="sm"
                  ring="background"
                  showEmpty
                />
              </AssigneeTrigger>
            )}
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

export default TaskRow;
