import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import BulkToolbar from "@/components/bulk-selection/bulk-toolbar";
import WorkspaceTimeline from "@/components/gantt/workspace-timeline";
import Spreadsheet from "@/components/spreadsheet/spreadsheet";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import LayoutToggle from "@/components/task-filters/layout-toggle";
import TaskToolbar from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import { defaultDisplay } from "@/lib/task-query/display";
import type {
  FilterCondition,
  TaskLayout,
  TaskQueryScope,
} from "@/lib/task-query/model";
import ScheduleLayoutBody from "./schedule-layout-body";
import TaskQueryView from "./task-query-view";

type TaskListSurfaceProps = {
  workspaceId: string;
  scope: TaskQueryScope;
  handle: TaskQueryStateHandle;
  /** The page's own scope (a view's base, "assigned to me"); no chip. */
  baseConditions?: readonly FilterCondition[];
  layouts: readonly TaskLayout[];
  /** Keeps each list's open and closed sections apart. */
  storageKey: string;
  hiddenSubjects?: readonly string[];
  /** Actions left of the layout toggle (Save view). */
  actions?: ReactNode;
  /** Shows "{n} tasks" beside the actions (views). */
  showCount?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  taskId?: string;
  onCloseTask: () => void;
  /** A quick add in each group and spreadsheet (off for others' work). */
  quickAdd?: boolean;
};

/**
 * A task list in query mode: the toolbar, then a grouped list or board or
 * the spreadsheet, the bulk bar and the task sheet. Workspace pages and
 * saved views are built from it.
 */
export default function TaskListSurface({
  workspaceId,
  scope,
  handle,
  baseConditions,
  layouts,
  storageKey,
  hiddenSubjects,
  actions,
  showCount = false,
  emptyTitle,
  emptyDescription,
  taskId,
  onCloseTask,
  quickAdd = true,
}: TaskListSurfaceProps) {
  const { t } = useTranslation();
  const layout = layouts.includes(handle.display.layout)
    ? handle.display.layout
    : (layouts[0] ?? "list");
  const isSpreadsheet = layout === "spreadsheet";
  // Calendar and Gantt draw a project's loaded tasks, not query rows.
  const scheduleLayout =
    scope.kind === "project" && (layout === "calendar" || layout === "gantt")
      ? layout
      : null;
  // A workspace view's Gantt fetches its own rows, one section per project.
  const workspaceTimeline = scope.kind === "workspace" && layout === "gantt";
  const scopedConfig = useDisplayConfig({ workspaceId, scope, layout });
  // It always groups by project and sorts by date, so those stay out of the menu.
  const displayConfig = workspaceTimeline
    ? {
        ...scopedConfig,
        groupByOptions: [],
        allowSubGroup: false,
        allowEmptyGroups: false,
        orderOptions: [],
      }
    : scopedConfig;
  const rows = useTaskQueryRows({
    workspaceId,
    scope,
    state: handle.state,
    baseConditions,
    limit: isSpreadsheet ? 100 : 50,
    ungrouped: isSpreadsheet,
    enabled: !scheduleLayout && !workspaceTimeline,
  });

  // The sheet needs the task's own project: from the rows, else the task.
  const row = taskId ? rows.data?.tasks[taskId] : undefined;
  const { data: task } = useGetTask(taskId && !row ? taskId : "");
  const taskProjectId =
    row?.projectId ??
    task?.projectId ??
    (scope.kind === "project" ? scope.projectId : "");
  const scopeKind = scope.kind === "project" ? "project" : "workspace";
  const scopeProjectId = scope.kind === "project" ? scope.projectId : undefined;
  // A new task is never archived, so an archive-only list offers no add.
  const offersQuickAdd = quickAdd && handle.state.archived !== "only";

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <TaskToolbar
        workspaceId={workspaceId}
        scope={scope}
        handle={handle}
        displayConfig={displayConfig}
        hiddenSubjects={hiddenSubjects}
        status={{
          isFetching: rows.isFetching && Boolean(rows.data),
          error: rows.data ? rows.error : null,
          onRetry: () => void rows.refetch(),
        }}
        rightSlot={
          <>
            {showCount && !workspaceTimeline && rows.data && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs">
                {t("views:detail.taskCount", { count: rows.data.totalCount })}
              </span>
            )}
            {actions}
            {layouts.length > 1 && (
              <LayoutToggle
                layouts={layouts}
                value={layout}
                onChange={(next) => handle.updateDisplay({ layout: next })}
                iconsOnly={scope.kind === "project"}
              />
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        {workspaceTimeline ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <WorkspaceTimeline
              workspaceId={workspaceId}
              scope={scope}
              state={handle.state}
              baseConditions={baseConditions}
              onClearFilters={
                handle.hasActiveFilters ? handle.clearFilters : undefined
              }
            />
          </div>
        ) : scheduleLayout && scope.kind === "project" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScheduleLayoutBody
              layout={scheduleLayout}
              workspaceId={workspaceId}
              projectId={scope.projectId}
              state={handle.state}
              baseConditions={baseConditions}
            />
          </div>
        ) : isSpreadsheet ? (
          <Spreadsheet
            query={rows}
            workspaceId={workspaceId}
            scope={scope}
            properties={handle.displayProperties}
            availableProperties={displayConfig.propertyKeys}
            orderBy={handle.display.orderBy}
            onSort={(orderBy) =>
              handle.updateDisplay({
                orderBy: orderBy ?? defaultDisplay(scopeKind).orderBy,
              })
            }
            onHideColumn={(property) =>
              handle.setDisplayProperty(property, false)
            }
            onHideCustomField={(fieldId) =>
              handle.setCustomFieldColumns(
                handle.displayProperties.customFields.filter(
                  (id) => id !== fieldId,
                ),
              )
            }
            onClearFilters={
              handle.hasActiveFilters ? handle.clearFilters : undefined
            }
            quickAdd={offersQuickAdd}
          />
        ) : (
          <TaskQueryView
            query={rows}
            layout={layout === "board" ? "board" : "list"}
            properties={handle.displayProperties}
            workspaceId={workspaceId}
            storageKey={storageKey}
            singleProject={scope.kind === "project"}
            onClearFilters={
              handle.hasActiveFilters ? handle.clearFilters : undefined
            }
            emptyTitle={handle.hasActiveFilters ? undefined : emptyTitle}
            emptyDescription={
              handle.hasActiveFilters ? undefined : emptyDescription
            }
            quickAdd={offersQuickAdd}
            projectId={scopeProjectId}
          />
        )}
      </div>
      <BulkToolbar
        projectId={scope.kind === "project" ? scope.projectId : null}
      />
      <TaskDetailsSheet
        taskId={taskId}
        projectId={taskProjectId}
        workspaceId={workspaceId}
        onClose={onCloseTask}
      />
    </div>
  );
}
