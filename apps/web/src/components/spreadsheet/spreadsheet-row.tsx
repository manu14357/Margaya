import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import TaskCardContextMenuContent from "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content";
import DeleteTaskDialog from "@/components/task-layouts/delete-task-dialog";
import { useTaskOpen } from "@/components/task-layouts/use-task-open";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/cn";
import type { DisplayProperties } from "@/lib/task-query/model";
import { rowToTask } from "@/lib/task-query/row-task";
import useBulkSelectionStore from "@/store/bulk-selection";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import {
  CUSTOM_FIELD_COLUMN_WIDTH,
  FIRST_COLUMN_WIDTH,
  type SpreadsheetColumn,
} from "./columns";
import SpreadsheetCell, { CustomFieldCell } from "./spreadsheet-cell";

/** Sub-tasks expand inline this deep; deeper ones open in the sheet. */
export const MAX_SUB_TASK_DEPTH = 3;

type SpreadsheetRowProps = {
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  workspaceId: string;
  columns: readonly SpreadsheetColumn[];
  customFieldIds: readonly string[];
  properties: DisplayProperties;
  depth: number;
  expanded: boolean;
  onToggleExpand: () => void;
  canEdit: boolean;
  canAssign: boolean;
};

/** One task: the sticky key and title, then one cell per column. */
export default function SpreadsheetRow({
  row,
  meta,
  workspaceId,
  columns,
  customFieldIds,
  properties,
  depth,
  expanded,
  onToggleExpand,
  canEdit,
  canAssign,
}: SpreadsheetRowProps) {
  const { t } = useTranslation();
  const openTask = useTaskOpen(workspaceId);
  // Select the values themselves: the React Compiler memoizes a call to the
  // store's stable `isSelected` getter, so the row would never update.
  const toggleSelection = useBulkSelectionStore((s) => s.toggleSelection);
  const selected = useBulkSelectionStore((s) => s.selectedTaskIds.has(row.id));
  const focused = useBulkSelectionStore((s) => s.focusedTaskId === row.id);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const expandable = (row.subTaskCount ?? 0) > 0 && depth < MAX_SUB_TASK_DEPTH;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <tr
            data-task-id={row.id}
            aria-selected={selected}
            className={cn(
              "group h-9 text-sm",
              selected ? "bg-accent/45" : "hover:bg-accent/40",
              focused && "outline-2 outline-ring/50 -outline-offset-2",
            )}
          >
            <td
              className={cn(
                "sticky left-0 z-[5] border-border border-b p-0",
                selected ? "bg-accent" : "bg-background group-hover:bg-accent",
              )}
              style={{
                width: FIRST_COLUMN_WIDTH,
                minWidth: FIRST_COLUMN_WIDTH,
                maxWidth: FIRST_COLUMN_WIDTH,
              }}
            >
              <div
                className="flex h-9 min-w-0 items-center gap-1.5 pr-2"
                style={{ paddingLeft: 8 + depth * 16 }}
              >
                <Checkbox
                  aria-label={t("tasks:spreadsheet.selectTask", {
                    key: row.key,
                  })}
                  checked={selected}
                  onCheckedChange={() => toggleSelection(row.id)}
                  className={cn(
                    "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                    selected && "opacity-100",
                  )}
                />
                {expandable ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={
                      expanded
                        ? t("tasks:spreadsheet.collapseSubTasks")
                        : t("tasks:spreadsheet.expandSubTasks")
                    }
                    onClick={onToggleExpand}
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                {properties.key && (
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {row.key}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => openTask(row, event)}
                  className={cn(
                    "min-w-0 truncate text-left hover:underline",
                    row.archivedAt && "text-muted-foreground",
                  )}
                >
                  {row.title}
                </button>
              </div>
            </td>
            {columns.map((column) => (
              <td
                key={column.property}
                className="border-border border-b border-l p-0"
                style={{
                  width: column.width,
                  minWidth: column.width,
                  maxWidth: column.width,
                }}
              >
                <SpreadsheetCell
                  column={column}
                  row={row}
                  meta={meta}
                  workspaceId={workspaceId}
                  canEdit={canEdit}
                  canAssign={canAssign}
                />
              </td>
            ))}
            {customFieldIds.map((fieldId) => (
              <td
                key={fieldId}
                className="border-border border-b border-l p-0"
                style={{
                  width: CUSTOM_FIELD_COLUMN_WIDTH,
                  minWidth: CUSTOM_FIELD_COLUMN_WIDTH,
                  maxWidth: CUSTOM_FIELD_COLUMN_WIDTH,
                }}
              >
                <CustomFieldCell row={row} fieldId={fieldId} />
              </td>
            ))}
            <td className="border-border border-b" />
          </tr>
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
    </>
  );
}
