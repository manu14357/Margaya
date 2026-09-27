import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type getTaskRelations from "@/fetchers/task-relation/get-task-relations";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { isClosedGroup } from "@/lib/column-groups";
import { formatTaskKey } from "@/lib/task-key";
import type Task from "@/types/task";
import AssigneeAvatarStack from "./assignee-avatar-stack";
import SubtaskAssigneePopover from "./subtask-assignee-popover";
import SubtaskStatusPopover from "./subtask-status-popover";

export type RelatedTaskSummary = NonNullable<
  Awaited<ReturnType<typeof getTaskRelations>>[number]["sourceTask"]
>;

export type ColumnLook = {
  icon?: string | null;
  isFinal?: boolean | null;
  group?: string | null;
};

type TaskRelationRowProps = {
  task: RelatedTaskSummary;
  /** Tasks of this project get the status and assignee pickers. */
  currentProjectId: string;
  workspaceId: string;
  canEdit: boolean;
  /** Column looks of the current project, by slug. */
  columns: ReadonlyMap<string, ColumnLook>;
  assignees: Parameters<typeof AssigneeAvatarStack>[0]["assignees"];
  onOpen: () => void;
  onRemove: () => void;
};

/** A task summary as the shared status and assignee popovers expect it. */
function toTask(task: RelatedTaskSummary): Task {
  return {
    id: task.id,
    title: task.title,
    number: task.number,
    description: null,
    status: task.status,
    priority: task.priority,
    startDate: null,
    dueDate: null,
    position: null,
    createdAt: "",
    updatedAt: "",
    userId: task.userId,
    assigneeId: task.userId,
    assigneeName: task.assigneeName,
    assigneeImage: "",
    assigneeIds: task.assigneeIds,
    projectId: task.projectId,
  };
}

/** One related task: status, key, title and assignees, with a context menu. */
export default function TaskRelationRow({
  task,
  currentProjectId,
  workspaceId,
  canEdit,
  columns,
  assignees,
  onOpen,
  onRemove,
}: TaskRelationRowProps) {
  const { t } = useTranslation();
  const sameProject = task.projectId === currentProjectId;
  const column = sameProject ? columns.get(task.status) : undefined;
  const closed =
    isClosedGroup(task.group) || Boolean(column?.isFinal && !task.group);
  const statusIcon = sameProject
    ? getColumnIcon(task.status, closed, column?.icon, task.group)
    : // Other projects' columns are unknown here: the group says enough.
      getColumnIcon("", closed, undefined, task.group);
  const key = formatTaskKey(task.projectSlug, task.number);
  const avatars = (
    <AssigneeAvatarStack
      assignees={assignees}
      max={2}
      size="xs"
      ring="background"
      showEmpty
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent/50">
          {sameProject ? (
            <SubtaskStatusPopover
              tasks={[toTask(task)]}
              projectId={task.projectId}
            >
              <button
                type="button"
                className="flex shrink-0 items-center justify-center rounded p-0.5 outline-none transition-colors [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
              >
                {statusIcon}
              </button>
            </SubtaskStatusPopover>
          ) : (
            <span className="flex shrink-0 items-center justify-center p-0.5">
              {statusIcon}
            </span>
          )}

          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
            onClick={onOpen}
          >
            <span
              className="shrink-0 font-mono text-muted-foreground text-xs"
              title={sameProject ? undefined : task.projectName}
            >
              {key}
            </span>
            <span
              className={cn(
                "block truncate text-sm",
                closed
                  ? "text-muted-foreground line-through"
                  : "text-foreground/90",
              )}
            >
              {task.title}
            </span>
          </button>

          {sameProject ? (
            <SubtaskAssigneePopover
              tasks={[toTask(task)]}
              workspaceId={workspaceId}
            >
              <button
                type="button"
                className="flex shrink-0 items-center justify-center rounded p-0.5 outline-none transition-colors"
              >
                {avatars}
              </button>
            </SubtaskAssigneePopover>
          ) : (
            <span className="flex shrink-0 items-center justify-center p-0.5">
              {avatars}
            </span>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-40">
        <ContextMenuItem onClick={onOpen}>
          <span>{t("tasks:relations.openTask")}</span>
        </ContextMenuItem>
        {canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive" onClick={onRemove}>
              <span>{t("tasks:relations.removeRelation")}</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
