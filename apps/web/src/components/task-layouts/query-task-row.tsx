import { type ReactNode, useState } from "react";
import TaskCardContextMenuContent from "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/cn";
import { getPriorityIcon } from "@/lib/priority";
import type { DisplayProperties } from "@/lib/task-query/model";
import { rowToTask } from "@/lib/task-query/row-task";
import useBulkSelectionStore from "@/store/bulk-selection";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import DeleteTaskDialog from "./delete-task-dialog";
import TaskChips, { DueDateChip } from "./task-chips";
import { useTaskOpen } from "./use-task-open";

type QueryTaskRowProps = {
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  properties: DisplayProperties;
  workspaceId: string;
  /** The row's own end (Archives: "Archived 3 days ago" and Restore). */
  rowEnd?: (row: TaskQueryRow) => ReactNode;
};

/** A list row of query mode: the list view's row, without drag and drop. */
export default function QueryTaskRow({
  row,
  meta,
  properties,
  workspaceId,
  rowEnd,
}: QueryTaskRowProps) {
  const openTask = useTaskOpen(workspaceId);
  // Select the values: the React Compiler memoizes calls to the store's
  // stable getters, so the row would not update on selection.
  const toggleSelection = useBulkSelectionStore((s) => s.toggleSelection);
  const selected = useBulkSelectionStore((s) => s.selectedTaskIds.has(row.id));
  const focused = useBulkSelectionStore((s) => s.focusedTaskId === row.id);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const assignees = (row.assigneeIds ?? []).flatMap((id) => {
    const user = meta.users.find((candidate) => candidate.id === id);
    return user ? [{ id: user.id, name: user.name, image: user.image }] : [];
  });

  const handleClick = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleSelection(row.id);
      return;
    }
    openTask(row);
  };

  return (
    <div
      data-selected={selected || undefined}
      data-task-row={row.id}
      className={cn(
        "relative border-border/50 border-b transition-colors duration-150",
        selected &&
          "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:bg-primary",
        focused && "ring-2 ring-ring/50 ring-inset",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* biome-ignore lint/a11y/useSemanticElements: a row with nested controls */}
          <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleClick(event);
            }}
            className={cn(
              "group relative flex min-h-9 cursor-pointer items-center gap-1.5 px-2 py-0.5 transition-colors md:gap-2 md:px-3",
              selected
                ? "bg-accent/45"
                : "hover:bg-accent/70 hover:shadow-[inset_2px_0_0_var(--primary)]",
            )}
          >
            {properties.priority && (
              <div className="flex size-6 shrink-0 items-center justify-center [&_svg]:size-3.5">
                {getPriorityIcon(row.priority)}
              </div>
            )}
            {properties.key && (
              <div className="w-16 shrink-0 truncate font-mono text-muted-foreground text-xs">
                {row.key}
              </div>
            )}
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span
                className={cn(
                  "truncate text-[13px] text-foreground",
                  row.archivedAt && "text-muted-foreground",
                )}
              >
                {row.title}
              </span>
              <div className="hidden items-center gap-1 sm:flex">
                <TaskChips
                  row={row}
                  meta={meta}
                  properties={properties}
                  showDueDate={false}
                />
              </div>
            </div>
            {properties.dueDate && <DueDateChip row={row} />}
            {properties.assignee && (
              <div className="flex flex-shrink-0">
                <AssigneeAvatarStack
                  assignees={assignees}
                  max={2}
                  size="sm"
                  ring="background"
                  showEmpty
                />
              </div>
            )}
            {rowEnd?.(row)}
          </div>
        </ContextMenuTrigger>
        <TaskCardContextMenuContent
          task={rowToTask(row, meta)}
          taskCardContext={{
            projectId: row.projectId,
            worskpaceId: workspaceId,
          }}
          onDeleteClick={() => setIsDeleteOpen(true)}
        />
      </ContextMenu>
      <DeleteTaskDialog
        taskId={row.id}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
    </div>
  );
}
