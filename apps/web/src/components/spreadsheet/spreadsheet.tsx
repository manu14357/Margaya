import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FocusedTaskShortcuts from "@/components/task/task-shortcuts/focused-task-shortcuts";
import QuickAdd from "@/components/task-draft/quick-add";
import {
  QueryEmpty,
  QueryRowsSkeleton,
} from "@/components/task-layouts/query-states";
import { useCreatedTaskCheck } from "@/components/task-layouts/use-created-task-check";
import { useTaskOpen } from "@/components/task-layouts/use-task-open";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Spinner } from "@/components/ui/spinner";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { assigneesOfTask } from "@/lib/task-assignees";
import { captureTargetFor } from "@/lib/task-query/capture-target";
import type {
  DisplayProperties,
  DisplayPropertyKey,
  OrderBy,
  TaskQueryScope,
} from "@/lib/task-query/model";
import useBulkSelectionStore from "@/store/bulk-selection";
import {
  CUSTOM_FIELD_COLUMN_WIDTH,
  FIRST_COLUMN_WIDTH,
  visibleColumns,
} from "./columns";
import SpreadsheetHeaderCell from "./spreadsheet-header-cell";
import SpreadsheetRow from "./spreadsheet-row";
import SubTaskRows from "./sub-task-rows";

export type SpreadsheetProps = {
  query: TaskQueryHandle;
  workspaceId: string;
  scope: TaskQueryScope;
  properties: DisplayProperties;
  /** The properties this surface offers (features off are left out). */
  availableProperties: readonly DisplayPropertyKey[];
  orderBy: OrderBy;
  onSort: (orderBy: OrderBy | null) => void;
  onHideColumn: (property: DisplayPropertyKey) => void;
  onHideCustomField?: (fieldId: string) => void;
  onClearFilters?: () => void;
  /** A last "add task" row, in a project's spreadsheet (task:create). */
  quickAdd?: boolean;
};

/**
 * The spreadsheet layout (B4 §6.5): a sticky header and first column, one
 * column per display property, inline editing, header sorting and 100 rows
 * at a time with infinite scroll.
 */
export default function Spreadsheet({
  query,
  workspaceId,
  scope,
  properties,
  availableProperties,
  orderBy,
  onSort,
  onHideColumn,
  onHideCustomField,
  onClearFilters,
  quickAdd = false,
}: SpreadsheetProps) {
  const { t } = useTranslation();
  const { canUpdateTasks, canAssignTasks, canCreateTasks } =
    useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const canAssign = canAssignTasks();
  const openTask = useTaskOpen(workspaceId);
  const checkCreated = useCreatedTaskCheck(query, workspaceId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { setAvailableTasks, focusNext, focusPrevious, toggleSelection } =
    useBulkSelectionStore();
  const { data } = query;
  const group = data?.groups[0];
  const rowIds = useMemo(() => group?.taskIds ?? [], [group]);
  const columns = visibleColumns(properties, availableProperties);
  const customFieldIds =
    scope.kind === "project"
      ? properties.customFields.filter((id) =>
          data?.meta.customFields.some((field) => field.id === id),
        )
      : [];

  useEffect(() => {
    setAvailableTasks(rowIds);
  }, [rowIds, setAvailableTasks]);

  const hasMore = Boolean(group?.nextCursor);
  const isLoadingMore = query.isLoadingMore("all");
  const { loadMore } = query;
  useEffect(() => {
    const target = sentinelRef.current;
    const root = scrollRef.current;
    if (!target || !root || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore("all");
      },
      { root, rootMargin: "200px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    const state = useBulkSelectionStore.getState();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNext();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusPrevious();
    } else if (event.key === "Enter" && state.focusedTaskId) {
      const row = data?.tasks[state.focusedTaskId];
      if (row) openTask(row);
    } else if (event.key === "x" && state.focusedTaskId) {
      toggleSelection(state.focusedTaskId);
    }
  };

  if (!data) {
    if (query.isError) {
      return (
        <div className="p-4">
          <ErrorDisplay
            error={query.error}
            title={t("tasks:spreadsheet.loadError")}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return <QueryRowsSkeleton rows={8} />;
  }

  if (data.totalCount === 0) return <QueryEmpty onClear={onClearFilters} />;

  // Only in one project's spreadsheet: a new task needs a project and column.
  const entryTarget =
    quickAdd && canCreateTasks() && scope.kind === "project"
      ? captureTargetFor({
          groupings: [],
          meta: data.meta,
          scopeProjectId: scope.projectId,
          can: {
            updateCycles: false,
            updateModules: false,
            updateTasks: false,
          },
        })
      : null;
  const columnCount = columns.length + customFieldIds.length + 2;

  const rowProps = {
    meta: data.meta,
    workspaceId,
    columns,
    customFieldIds,
    properties,
    canEdit,
    canAssign,
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard navigation of the rows
    <div
      ref={scrollRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="h-full w-full overflow-auto bg-background outline-none"
    >
      <FocusedTaskShortcuts
        resolve={(taskId) => {
          const task = data.tasks[taskId];
          if (!task) return null;
          return {
            taskId: task.id,
            projectId: task.projectId,
            workspaceId,
            key: task.key,
            assigneeIds: assigneesOfTask(task),
          };
        }}
      />
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-20 h-8 border-border border-b bg-muted px-2 text-left align-middle font-medium text-muted-foreground text-xs"
              style={{
                width: FIRST_COLUMN_WIDTH,
                minWidth: FIRST_COLUMN_WIDTH,
                maxWidth: FIRST_COLUMN_WIDTH,
              }}
            >
              <span className="pl-12">{t("tasks:spreadsheet.task")}</span>
            </th>
            {columns.map((column) => (
              <SpreadsheetHeaderCell
                key={column.property}
                label={t(column.labelKey)}
                width={column.width}
                sortField={column.sortField}
                orderBy={orderBy}
                onSort={onSort}
                onHide={() => onHideColumn(column.property)}
              />
            ))}
            {customFieldIds.map((fieldId) => (
              <SpreadsheetHeaderCell
                key={fieldId}
                label={
                  data.meta.customFields.find((field) => field.id === fieldId)
                    ?.name ?? fieldId
                }
                width={CUSTOM_FIELD_COLUMN_WIDTH}
                sortField={null}
                orderBy={orderBy}
                onSort={onSort}
                onHide={() => onHideCustomField?.(fieldId)}
              />
            ))}
            <th className="sticky top-0 z-10 border-border border-b bg-card" />
          </tr>
        </thead>
        <tbody>
          {rowIds.map((id) => {
            const row = data.tasks[id];
            if (!row) return null;
            const isExpanded = Boolean(expanded[id]);
            return (
              <SpreadsheetRowGroup key={id}>
                <SpreadsheetRow
                  row={row}
                  depth={0}
                  expanded={isExpanded}
                  onToggleExpand={() =>
                    setExpanded((current) => ({
                      ...current,
                      [id]: !isExpanded,
                    }))
                  }
                  {...rowProps}
                />
                {isExpanded && (
                  <SubTaskRows
                    parentId={id}
                    depth={1}
                    scope={scope}
                    orderBy={orderBy}
                    properties={properties}
                    rowProps={rowProps}
                  />
                )}
              </SpreadsheetRowGroup>
            );
          })}
          {hasMore && (
            <tr ref={sentinelRef}>
              <td colSpan={columnCount}>
                <div className="flex h-9 items-center px-3 text-muted-foreground text-xs">
                  {isLoadingMore && <Spinner className="size-3.5" />}
                </div>
              </td>
            </tr>
          )}
          {entryTarget && (
            <tr data-spreadsheet-quick-add>
              <td
                className="sticky left-0 z-10 border-border/60 border-b bg-background px-1 py-1 align-top"
                style={{
                  width: FIRST_COLUMN_WIDTH,
                  minWidth: FIRST_COLUMN_WIDTH,
                  maxWidth: FIRST_COLUMN_WIDTH,
                }}
              >
                <QuickAdd
                  projectId={entryTarget.projectId}
                  workspaceId={workspaceId}
                  prefill={{
                    status: entryTarget.status,
                    targetName: entryTarget.statusName,
                  }}
                  onCreated={(task) => void checkCreated(task)}
                />
              </td>
              <td
                colSpan={columnCount - 1}
                className="border-border/60 border-b"
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SpreadsheetRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
