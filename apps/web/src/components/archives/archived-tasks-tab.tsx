import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import TaskToolbar from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import TaskQueryView from "@/components/task-layouts/task-query-view";
import { useArchiveTask } from "@/hooks/mutations/task/use-archive-task";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { withoutTaskIds } from "@/lib/archives";
import {
  DEFAULT_DISPLAY_PROPERTIES,
  defaultDisplay,
} from "@/lib/task-query/display";
import type {
  TaskLayout,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import ArchivedTaskRowEnd from "./archived-task-row-end";
import ArchivedTasksBulkBar from "./archived-tasks-bulk-bar";
import DeleteArchivedTasksDialog from "./delete-archived-tasks-dialog";

const LAYOUTS: readonly TaskLayout[] = ["list"];

/** Ungrouped, most recently archived first. */
function archivesBaseline(scope: "project" | "workspace"): TaskQueryState {
  return {
    filters: null,
    // The archived rule is fixed to "only" when querying, not stored.
    archived: "exclude",
    display: {
      ...defaultDisplay(scope),
      layout: "list",
      groupBy: null,
      subGroupBy: null,
      orderBy: { field: "archivedAt", direction: "desc" },
    },
    displayProperties: { ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] },
  };
}

type ArchivedTasksTabProps = {
  workspaceId: string;
  /** The project scope (project Archives) or the workspace filter. */
  projectId?: string;
  isProjectScope: boolean;
  taskId?: string;
};

/** Archived tasks from the task query engine, with restore and delete. */
export default function ArchivedTasksTab({
  workspaceId,
  projectId,
  isProjectScope,
  taskId,
}: ArchivedTasksTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canUpdateTasks, canDeleteTasks, isCheckingPermissions } =
    useWorkspacePermission();
  const canRestore = !isCheckingPermissions && canUpdateTasks();
  const canDelete = !isCheckingPermissions && canDeleteTasks();
  const displayScope = isProjectScope ? "project" : "workspace";
  const scope = useMemo<TaskQueryScope>(
    () =>
      isProjectScope && projectId
        ? { kind: "project", projectId }
        : projectId
          ? { kind: "workspace", projectIds: [projectId] }
          : { kind: "workspace" },
    [isProjectScope, projectId],
  );
  const baseline = useMemo(
    () => archivesBaseline(displayScope),
    [displayScope],
  );
  const handle = useTaskQueryState({
    storageScope: `archives:${isProjectScope ? projectId : "workspace"}`,
    scope: displayScope,
    workspaceId,
    baseline,
    allowedLayouts: LAYOUTS,
  });
  const queryState = useMemo<TaskQueryState>(
    () => ({
      ...handle.state,
      archived: "only",
      display: { ...handle.state.display, layout: "list" },
    }),
    [handle.state],
  );
  const rows = useTaskQueryRows({
    workspaceId,
    scope,
    state: queryState,
    limit: 50,
  });

  const baseConfig = useDisplayConfig({ workspaceId, scope, layout: "list" });
  const displayConfig = useMemo(
    () => ({
      ...baseConfig,
      orderOptions: ["archivedAt" as const, ...baseConfig.orderOptions],
    }),
    [baseConfig],
  );

  // Restored rows leave at once; a failure brings them back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const view = useMemo(
    () =>
      rows.data && hidden.size > 0
        ? { ...rows, data: withoutTaskIds(rows.data, hidden) }
        : rows,
    [rows, hidden],
  );
  const { mutateAsync: archiveTask } = useArchiveTask();
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const clearSelection = useBulkSelectionStore((state) => state.clearSelection);

  useEffect(() => {
    clearSelection();
    return clearSelection;
  }, [clearSelection]);

  const setHiddenIds = useCallback(
    (ids: readonly string[], hide: boolean) =>
      setHidden((previous) => {
        const next = new Set(previous);
        for (const id of ids) {
          if (hide) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    [],
  );

  const restoreOne = useCallback(
    async (row: { id: string; projectId: string }) => {
      setHiddenIds([row.id], true);
      try {
        await archiveTask({
          taskId: row.id,
          projectId: row.projectId,
          archived: false,
        });
        void queryClient.invalidateQueries({
          queryKey: archiveQueryKeys.all(),
        });
        toast.success(t("workspace:archives.toast.taskRestored"));
      } catch {
        setHiddenIds([row.id], false);
        toast.error(t("workspace:archives.toast.restoreError"));
      }
    },
    [archiveTask, queryClient, setHiddenIds, t],
  );

  const closeTask = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  // The sheet needs the task's own project: from the rows, else the task.
  const openRow = taskId ? rows.data?.tasks[taskId] : undefined;
  const { data: openTask } = useGetTask(taskId && !openRow ? taskId : "");
  const sheetProjectId =
    openRow?.projectId ??
    openTask?.projectId ??
    (isProjectScope ? (projectId ?? "") : "");

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <TaskToolbar
        workspaceId={workspaceId}
        scope={scope}
        handle={handle}
        displayConfig={displayConfig}
        showArchived={false}
        status={{
          isFetching: rows.isFetching && Boolean(rows.data),
          error: rows.data ? rows.error : null,
          onRetry: () => void rows.refetch(),
        }}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <TaskQueryView
          query={view}
          layout="list"
          properties={{ ...handle.displayProperties, dueDate: false }}
          workspaceId={workspaceId}
          storageKey={`archives:${isProjectScope ? projectId : "workspace"}`}
          singleProject={isProjectScope}
          onClearFilters={
            handle.hasActiveFilters ? handle.clearFilters : undefined
          }
          emptyTitle={
            handle.hasActiveFilters
              ? undefined
              : t("workspace:archives.empty.tasksTitle")
          }
          emptyDescription={
            handle.hasActiveFilters
              ? undefined
              : t("workspace:archives.empty.tasksDescription")
          }
          rowEnd={(row) => (
            <ArchivedTaskRowEnd
              row={row}
              workspaceId={workspaceId}
              canRestore={canRestore}
              canDelete={canDelete}
              onRestore={() => void restoreOne(row)}
              onDelete={() => setDeleting([row.id])}
            />
          )}
        />
      </div>
      <ArchivedTasksBulkBar
        canRestore={canRestore}
        canDelete={canDelete}
        onRestored={(ids) => setHiddenIds(ids, true)}
        onRestoreFailed={(ids) => setHiddenIds(ids, false)}
        onDelete={(ids) => setDeleting(ids)}
      />
      <DeleteArchivedTasksDialog
        taskIds={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={(ids) => setHiddenIds(ids, true)}
      />
      <TaskDetailsSheet
        taskId={taskId}
        projectId={sheetProjectId}
        workspaceId={workspaceId}
        onClose={closeTask}
      />
    </div>
  );
}
