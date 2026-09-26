import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import TaskCardContextMenuContent from "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getColumnIcon } from "@/lib/column";
import type { AssigneeEntry } from "@/lib/task-assignees";
import type Task from "@/types/task";
import AssigneeAvatarStack from "./assignee-avatar-stack";
import SubtaskAssigneePopover from "./subtask-assignee-popover";
import SubtaskStatusPopover from "./subtask-status-popover";

type SubtaskRowProps = {
  task: Task;
  tasks: Task[];
  projectId: string;
  workspaceId: string;
  isSelected: boolean;
  isFocused: boolean;
  isCompleted: boolean;
  canEdit: boolean;
  /** Set when the subtask cannot be marked complete (no completed column). */
  completeDisabledReason?: string;
  selectionRadius: string;
  /** The subtask's assignees, resolved for display. */
  assignees: AssigneeEntry[];
  onToggleComplete: () => void;
  onNavigate: () => void;
  onDeleteClick: () => void;
};

export default function SubtaskRow({
  task,
  tasks,
  projectId,
  workspaceId,
  isSelected,
  isFocused,
  isCompleted,
  canEdit,
  completeDisabledReason,
  selectionRadius,
  assignees,
  onToggleComplete,
  onNavigate,
  onDeleteClick,
}: SubtaskRowProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useTranslation();

  return (
    <motion.div
      layout
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, scale: 0.98 }
      }
      animate={
        reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto", scale: 1 }
      }
      exit={
        reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, scale: 0.98 }
      }
      transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`group flex items-center gap-2 py-1 px-2 ${selectionRadius} transition-colors cursor-default ${isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/50"} ${isFocused ? "ring-1 ring-inset ring-ring/50" : ""}`}
          >
            {/* Completion checkbox: toggles the subtask done/undone and persists it. */}
            {!isCompleted && completeDisabledReason ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <Checkbox
                      checked={false}
                      disabled
                      aria-label={completeDisabledReason}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{completeDisabledReason}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Checkbox
                checked={isCompleted}
                onCheckedChange={onToggleComplete}
                disabled={!canEdit}
                aria-label={t("tasks:subtasks.completeAria", {
                  defaultValue: "Mark subtask complete",
                })}
              />
            )}

            <SubtaskStatusPopover tasks={tasks} projectId={projectId}>
              <button
                type="button"
                className="shrink-0 flex items-center justify-center rounded p-0.5 transition-colors outline-none [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
              >
                {getColumnIcon(task.status, false)}
              </button>
            </SubtaskStatusPopover>

            <button
              type="button"
              className="flex-1 min-w-0 text-left outline-none"
              onClick={onNavigate}
            >
              <span
                className={`text-sm truncate block ${isCompleted ? "line-through text-muted-foreground" : "text-foreground/90"}`}
              >
                {task.title}
              </span>
            </button>

            <SubtaskAssigneePopover tasks={tasks} workspaceId={workspaceId}>
              <button
                type="button"
                className="shrink-0 flex items-center justify-center rounded p-0.5 transition-colors outline-none"
              >
                <AssigneeAvatarStack
                  assignees={assignees}
                  max={2}
                  size="xs"
                  ring="background"
                  showEmpty
                />
              </button>
            </SubtaskAssigneePopover>
          </div>
        </ContextMenuTrigger>

        <TaskCardContextMenuContent
          task={task}
          taskCardContext={{
            projectId,
            worskpaceId: workspaceId,
          }}
          onDeleteClick={onDeleteClick}
        />
      </ContextMenu>
    </motion.div>
  );
}
