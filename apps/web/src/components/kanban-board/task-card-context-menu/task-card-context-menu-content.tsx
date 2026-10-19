import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Calendar } from "@/components/ui/calendar";
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useArchiveTask } from "@/hooks/mutations/task/use-archive-task";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useUpdateTaskDescription } from "@/hooks/mutations/task/use-update-task-description";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { copyTaskKey, copyTaskLink } from "@/lib/copy-task-reference";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { formatTaskKey, shareableTaskUrl } from "@/lib/task-key";
import { TaskPropertySlotOutlet } from "@/lib/task-property-slots";
import { toastTaskArchived, toastTaskStatusChanged } from "@/lib/task-undo";
import { toast } from "@/lib/toast";
import useCopyTaskDialog from "@/store/copy-task-dialog";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import TaskAssigneesContextSubmenu from "./task-assignees-context-submenu";

type TaskCardContext = {
  worskpaceId: string;
  projectId: string;
};

type TaskCardContextMenuContentProps = {
  task: Task;
  taskCardContext: TaskCardContext;
  onDeleteClick: () => void;
};

export default function TaskCardContextMenuContent({
  task,
  taskCardContext,
  onDeleteClick,
}: TaskCardContextMenuContentProps) {
  const { t } = useTranslation();
  const { project } = useProjectStore();
  // The task's own project: a card can show a task of another project.
  const taskProjectId = task.projectId || taskCardContext.projectId;
  const { data: columnsData = [] } = useGetColumns(taskProjectId);
  const columns =
    project?.id === taskProjectId &&
    project?.columns &&
    project.columns.length > 0
      ? project.columns.map((col) => ({
          slug: col.id,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
          group: col.group,
        }))
      : columnsData.map((col) => ({
          slug: col.slug,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
          group: col.group,
        }));
  const { mutateAsync: updateTask } = useUpdateTask();
  const { mutateAsync: updateTaskPriority } = useUpdateTaskPriority();
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { mutateAsync: updateTaskDescription } = useUpdateTaskDescription();
  const { mutateAsync: updateTaskDueDate } = useUpdateTaskDueDate();
  const { mutateAsync: setArchived } = useArchiveTask();
  const { canUpdateTasks, canDeleteTasks, canAssignTasks, canCreateTasks } =
    useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const canDelete = canDeleteTasks();
  const canAssign = canAssignTasks();
  const canCreate = canCreateTasks();
  const openCopyDialog = useCopyTaskDialog((state) => state.open);

  const { data: taskProject } = useGetProject({
    id: taskProjectId,
    workspaceId: taskCardContext.worskpaceId,
  });
  const taskSlug =
    taskProject?.slug ??
    (project?.id === taskProjectId ? project.slug : undefined);

  const handleCopyTaskLink = () => {
    void copyTaskLink(
      shareableTaskUrl({
        workspaceId: taskCardContext.worskpaceId,
        projectId: taskProjectId,
        taskId: task.id,
        slug: taskSlug,
        number: task.number,
      }),
      t,
    );
  };

  const handleCopyTaskKey = () => {
    if (!taskSlug) return;
    void copyTaskKey(formatTaskKey(taskSlug, task.number), t);
  };

  // Archiving keeps the task's column (D7); restoring brings it back there.
  const handleArchive = async (archived: boolean) => {
    try {
      await setArchived({
        taskId: task.id,
        projectId: taskProjectId,
        archived,
      });
      if (archived) {
        toastTaskArchived({ taskId: task.id, projectId: taskProjectId }, { t });
      } else {
        toast.success(t("tasks:archive.restored"));
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t(archived ? "tasks:archive.error" : "tasks:archive.restoreError"),
      );
    }
  };

  const handleChange = async (field: keyof Task, value: string | Date) => {
    try {
      switch (field) {
        case "priority":
          await updateTaskPriority({ ...task, priority: value as string });
          break;
        case "status":
          await updateTaskStatus({ ...task, status: value as string });
          toastTaskStatusChanged(
            {
              taskId: task.id,
              projectId: task.projectId,
              previousStatus: task.status,
              nextStatus: value as string,
            },
            { t },
          );
          return;
        case "title":
          await updateTaskTitle({ ...task, title: value as string });
          break;
        case "description":
          await updateTaskDescription({
            ...task,
            description: value as string,
          });
          break;
        default:
          await updateTask({
            ...task,
            [field]: value,
          });
      }
      toast.success(t("tasks:update.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:update.error"),
      );
    }
  };

  return (
    <ContextMenuContent className="w-46">
      <ContextMenuItem onClick={handleCopyTaskLink}>
        <span>{t("tasks:contextMenu.copyLink")}</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCopyTaskKey} disabled={!taskSlug}>
        <span>{t("tasks:actions.copyKey")}</span>
      </ContextMenuItem>
      {canCreate && (
        <ContextMenuItem
          onClick={() =>
            openCopyDialog({
              taskId: task.id,
              projectId: taskProjectId,
              workspaceId: taskCardContext.worskpaceId,
            })
          }
        >
          <span>{t("tasks:actions.makeCopy")}</span>
        </ContextMenuItem>
      )}

      {(canEdit || canAssign) && <ContextMenuSeparator />}

      {canEdit && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <span>{t("tasks:priority.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuCheckboxItem
              key="no-priority"
              checked={task.priority === "no-priority"}
              onCheckedChange={() => handleChange("priority", "no-priority")}
              closeOnClick
              className="[&_svg]:text-muted-foreground"
            >
              {getPriorityIcon("no-priority")}
              <span>{getPriorityLabel("no-priority")}</span>
            </ContextMenuCheckboxItem>
            {["low", "medium", "high", "urgent"].map((priority) => (
              <ContextMenuCheckboxItem
                key={priority}
                checked={task.priority === priority}
                onCheckedChange={() => handleChange("priority", priority)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
              >
                {getPriorityIcon(priority)}
                <span className="capitalize">{getPriorityLabel(priority)}</span>
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      {canEdit && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <span>{t("tasks:status.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {columns.map((col) => (
              <ContextMenuCheckboxItem
                key={col.slug}
                checked={task.status === col.slug}
                onCheckedChange={() => handleChange("status", col.slug)}
                closeOnClick
                className="[&_svg]:text-muted-foreground"
              >
                {getColumnIcon(col.slug, col.isFinal, col.icon, col.group)}
                <span>{col.name}</span>
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      {canEdit && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <span>{t("tasks:dueDate.label")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-fit min-w-0 p-0">
            <div className="p-2">
              <Calendar
                mode="single"
                selected={task.dueDate ? new Date(task.dueDate) : undefined}
                onSelect={async (date) => {
                  try {
                    await updateTaskDueDate({
                      ...task,
                      dueDate: date?.toISOString() || null,
                    });
                    toast.success(t("tasks:dueDate.updateSuccess"));
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : t("tasks:dueDate.updateError"),
                    );
                  }
                }}
                className="w-full bg-popover!"
              />
            </div>
            {task.dueDate && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="gap-2 text-muted-foreground"
                  onClick={async () => {
                    try {
                      await updateTaskDueDate({
                        ...task,
                        dueDate: null,
                      });
                      toast.success(t("tasks:dueDate.clearSuccess"));
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("tasks:dueDate.clearError"),
                      );
                    }
                  }}
                >
                  <X className="h-4 w-4" />
                  <span>{t("tasks:dueDate.clear")}</span>
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}

      {canAssign && (
        <TaskAssigneesContextSubmenu
          task={task}
          projectId={taskCardContext.projectId}
          workspaceId={taskCardContext.worskpaceId}
        />
      )}

      {/* Feature slices (cycles, modules) add their submenus here; each
          slot checks its own permission. */}
      <TaskPropertySlotOutlet
        location="contextMenu"
        projectId={taskCardContext.projectId}
        workspaceId={taskCardContext.worskpaceId}
        props={{ task }}
      />

      {(canEdit || canDelete) && (
        <>
          {canEdit && (
            <>
              <ContextMenuSeparator />

              {task.archivedAt ? (
                <ContextMenuItem onClick={() => void handleArchive(false)}>
                  <span>{t("tasks:archive.restore")}</span>
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onClick={() => void handleArchive(true)}>
                  <span>{t("tasks:actions.archive")}</span>
                </ContextMenuItem>
              )}

              {task.status !== "planned" && (
                <ContextMenuItem
                  onClick={() => handleChange("status", "planned")}
                >
                  <span>{t("tasks:actions.markAsPlanned")}</span>
                </ContextMenuItem>
              )}
            </>
          )}

          {canDelete && (
            <>
              <ContextMenuSeparator />

              <ContextMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  setTimeout(() => {
                    onDeleteClick();
                  }, 0);
                }}
              >
                <span>{t("tasks:actions.delete")}</span>
              </ContextMenuItem>
            </>
          )}
        </>
      )}
    </ContextMenuContent>
  );
}
