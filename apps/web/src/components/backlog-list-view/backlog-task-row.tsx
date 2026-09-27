import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  Calendar,
  CalendarClock,
  CalendarX,
  SlidersHorizontal,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import useGetCustomFieldValuesByProject from "@/hooks/queries/custom-field/use-get-custom-field-values-by-project";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { getPriorityIcon } from "@/lib/priority";
import { TaskPropertySlotOutlet } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { TaskLabels } from "../kanban-board/task-labels";
import AssigneeAvatarStack from "../task/assignee-avatar-stack";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";

type BacklogTaskRowProps = {
  task: Task;
};

export default function BacklogTaskRow({ task }: BacklogTaskRowProps) {
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
  const toggleSelection = useBacklogBulkSelectionStore(
    (s) => s.toggleSelection,
  );
  const isTaskSelected = useBacklogBulkSelectionStore((s) =>
    s.selectedTaskIds.has(task.id),
  );
  const isTaskFocused = useBacklogBulkSelectionStore(
    (s) => s.focusedTaskId === task.id,
  );

  const assignees = useTaskAssignees(task, workspace?.id ?? "");

  const { data: projectCustomFieldValues = [] } =
    useGetCustomFieldValuesByProject(task.projectId);

  const customFieldValues = useMemo(
    () => projectCustomFieldValues.filter((field) => field.taskId === task.id),
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask(task.id);
      toast.success(t("tasks:delete.success"));
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
            onKeyDown={handleKeyDown}
            className={cn(
              "group relative flex min-h-9 cursor-pointer items-center gap-1.5 px-2 py-0.5 transition-colors md:gap-2 md:px-3",
              isTaskSelected ? "bg-accent/45" : "hover:bg-accent/60",
            )}
            {...attributes}
            {...listeners}
          >
            {showPriority && (
              <div className="flex size-6 shrink-0 items-center justify-center [&_svg]:size-3.5">
                {getPriorityIcon(task.priority ?? "")}
              </div>
            )}
            {showTaskNumbers && (
              <div className="w-16 shrink-0 truncate font-mono text-muted-foreground text-xs">
                {project?.slug}-{task.number}
              </div>
            )}

            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="flex items-center gap-2 justify-between w-full">
                <span className="truncate text-[13px] text-foreground">
                  {task.title}
                </span>
                {showLabels && (
                  <div className="flex items-center gap-1">
                    <TaskLabels labels={task.labels ?? []} />
                  </div>
                )}
              </div>
            </div>

            {showDueDates && task.dueDate && (
              <div
                className={`flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
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

            {/* Hidden while every slot renders nothing, so no gap is left. */}
            <div className="flex flex-shrink-0 items-center gap-1 empty:hidden">
              <TaskPropertySlotOutlet
                location="cardChip"
                projectId={task.projectId}
                workspaceId={workspace?.id ?? ""}
                props={{ task }}
              />
            </div>

            {showAssignees && (
              <div className="flex flex-shrink-0">
                <AssigneeAvatarStack
                  assignees={assignees}
                  max={2}
                  size="md"
                  ring="background"
                  showEmpty
                />
              </div>
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
