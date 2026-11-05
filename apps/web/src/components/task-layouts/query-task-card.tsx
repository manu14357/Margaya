import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import {
  SelectionCheckbox,
  useCanBulkSelect,
} from "@/components/bulk-selection/selection-checkbox";
import TaskCardContextMenuContent from "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ProjectScope } from "@/hooks/use-project-scope";
import { cn } from "@/lib/cn";
import { getPriorityIcon } from "@/lib/priority";
import type { DisplayProperties } from "@/lib/task-query/model";
import { rowToTask } from "@/lib/task-query/row-task";
import useBulkSelectionStore from "@/store/bulk-selection";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import DeleteTaskDialog from "./delete-task-dialog";
import TaskChips from "./task-chips";
import { useTaskOpen } from "./use-task-open";

type QueryTaskCardProps = {
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  properties: DisplayProperties;
  workspaceId: string;
  /** Unique per placement: a task can sit in several groups. */
  dragId: string;
  /** Where the card sits: its group and sub-group cell. */
  place: { group: string; sub: string | null };
  draggable: boolean;
};

/** A board card for query mode: the kanban card's look, no reordering. */
export function QueryTaskCardBody({
  row,
  meta,
  properties,
}: Pick<QueryTaskCardProps, "row" | "meta" | "properties">) {
  const assignees = (row.assigneeIds ?? []).flatMap((id) => {
    const user = meta.users.find((candidate) => candidate.id === id);
    return user ? [{ id: user.id, name: user.name, image: user.image }] : [];
  });
  return (
    <>
      {properties.key && (
        <div className="mb-1 font-mono text-[11px] text-muted-foreground leading-4">
          {row.key}
        </div>
      )}
      <div
        className={cn(
          "line-clamp-3 break-words font-medium text-[13px] text-foreground leading-[18px]",
          // Without a key line the title shares the top row with the selection
          // control.
          !properties.key && "pe-5",
        )}
      >
        {row.title}
      </div>
      <div className="mt-2 flex min-h-5 items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {properties.priority && row.priority !== "no-priority" && (
            <span className="inline-flex h-5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-1.5 font-medium text-[10px] text-muted-foreground">
              {getPriorityIcon(row.priority)}
            </span>
          )}
          <TaskChips row={row} meta={meta} properties={properties} />
        </div>
        {properties.assignee && (
          <div className="ms-auto flex shrink-0">
            <AssigneeAvatarStack
              assignees={assignees}
              max={2}
              size="sm"
              ring="background"
              showEmpty
            />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Menus and editors in the row act in the task's own project, so its project
 * role there decides what they offer, whatever list shows the row.
 */
export default function QueryTaskCard(props: QueryTaskCardProps) {
  return (
    <ProjectScope projectId={props.row.projectId}>
      <ScopedQueryTaskCard {...props} />
    </ProjectScope>
  );
}

function ScopedQueryTaskCard({
  row,
  meta,
  properties,
  workspaceId,
  dragId,
  place,
  draggable,
}: QueryTaskCardProps) {
  const openTask = useTaskOpen(workspaceId);
  // Select the values: the React Compiler memoizes calls to the store's
  // stable getters, so the card would not update on selection.
  const toggleSelection = useBulkSelectionStore((s) => s.toggleSelection);
  const selected = useBulkSelectionStore((s) => s.selectedTaskIds.has(row.id));
  const focused = useBulkSelectionStore((s) => s.focusedTaskId === row.id);
  const selectionActive = useBulkSelectionStore(
    (s) => s.selectedTaskIds.size > 0,
  );
  const selectable = useCanBulkSelect();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: dragId,
      disabled: !draggable,
      data: { taskId: row.id, group: place.group, sub: place.sub },
    });

  const handleClick = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(row.id);
      return;
    }
    openTask(row);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
      className="group/selectable"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* biome-ignore lint/a11y/useSemanticElements: a card with nested controls */}
          <div
            role="button"
            tabIndex={0}
            data-selected={selected || undefined}
            onClick={handleClick}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleClick(event);
            }}
            className={cn(
              "group relative rounded-lg border bg-background px-2.5 py-2 shadow-xs/5 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
              draggable ? "cursor-move" : "cursor-pointer",
              selected
                ? "border-ring/40 bg-accent/50 shadow-sm ring-1 ring-ring/30 ring-inset"
                : "border-border hover:border-border/90 hover:shadow-sm",
              focused && "ring-2 ring-ring/50 ring-inset",
              row.archivedAt && "opacity-80",
            )}
          >
            {selectable && (
              <SelectionCheckbox
                title={row.title}
                checked={selected}
                selectionActive={selectionActive}
                onToggle={() => toggleSelection(row.id)}
                className="absolute end-1.5 top-1.5 z-10"
              />
            )}
            <QueryTaskCardBody row={row} meta={meta} properties={properties} />
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
