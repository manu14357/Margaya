import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import TaskPriorityPopover from "@/components/task/task-priority-popover";
import TaskStatusPopover from "@/components/task/task-status-popover";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export type TriageKind = "status" | "priority" | "assignee";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Keeps a row's own click (open the task), drag (dnd-kit) and keys away from
 * a property trigger and its popover, which React bubbles through the row.
 */
function TriageSlot({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only stops propagation; the trigger inside handles keys
    <span
      className="flex shrink-0 items-center"
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
    >
      {children}
    </span>
  );
}

const triggerClass =
  "flex h-6 min-w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The status glyph: `s` opens it on the focused row. */
export function StatusTrigger({
  task,
  column,
}: {
  task: Task;
  column: ProjectWithTasks["columns"][number] | undefined;
}) {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission();
  const name = getStatusDisplayLabel(task.status, column?.name ?? task.status);
  const icon = column
    ? getColumnIcon(column.id, column.isFinal, column.icon, column.group)
    : null;
  if (!canUpdateTasks()) {
    return (
      <span className="flex size-6 items-center justify-center" title={name}>
        {icon}
      </span>
    );
  }
  return (
    <TriageSlot>
      <TaskStatusPopover task={task}>
        <button
          type="button"
          data-triage="status"
          className={triggerClass}
          aria-label={t("tasks:triage.changeStatus", { status: name })}
        >
          {icon}
        </button>
      </TaskStatusPopover>
    </TriageSlot>
  );
}

/** The priority icon: `!` opens it on the focused row. */
export function PriorityTrigger({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission();
  const priority = task.priority ?? "no-priority";
  const icon = (
    <span className="flex [&_svg]:size-3.5">{getPriorityIcon(priority)}</span>
  );
  if (!canUpdateTasks()) {
    return (
      <span className="flex size-6 items-center justify-center">{icon}</span>
    );
  }
  return (
    <TriageSlot>
      <TaskPriorityPopover task={task}>
        <button
          type="button"
          data-triage="priority"
          className={triggerClass}
          aria-label={t("tasks:triage.changePriority", {
            priority: getPriorityLabel(priority),
          })}
        >
          {icon}
        </button>
      </TaskPriorityPopover>
    </TriageSlot>
  );
}

/** The assignee stack: `a` opens it on the focused row. */
export function AssigneeTrigger({
  task,
  workspaceId,
  children,
}: {
  task: Task;
  workspaceId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { canAssignTasks } = useWorkspacePermission();
  if (!canAssignTasks()) return <span className="flex">{children}</span>;
  return (
    <TriageSlot>
      <TaskAssigneePopover task={task} workspaceId={workspaceId}>
        <button
          type="button"
          data-triage="assignee"
          className={`${triggerClass} px-0.5`}
          aria-label={t("tasks:triage.changeAssignees")}
        >
          {children}
        </button>
      </TaskAssigneePopover>
    </TriageSlot>
  );
}
