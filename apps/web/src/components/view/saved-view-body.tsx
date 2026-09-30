import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import TaskListSurface from "@/components/task-layouts/task-list-surface";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import type { TaskLayout, TaskQueryScope } from "@/lib/task-query/model";
import { viewScopeOf, viewToState } from "@/lib/task-query/view-state";
import type { SavedView } from "@/types/view";
import SaveViewActions from "./save-view-actions";

/**
 * The layouts a view page offers. Calendar and gantt stay on the project's
 * own pages; a view saved with them opens as a list.
 */
export const VIEW_PAGE_LAYOUTS: readonly TaskLayout[] = [
  "list",
  "board",
  "spreadsheet",
];

type SavedViewBodyProps = {
  view: SavedView;
  taskId?: string;
};

/**
 * A saved view's list: its filters and display as the baseline, unsaved
 * changes kept per view in the browser, and Save / Save as new / Reset.
 */
export default function SavedViewBody({ view, taskId }: SavedViewBodyProps) {
  const navigate = useNavigate();
  const scopeKind = viewScopeOf(view);
  const scope = useMemo<TaskQueryScope>(
    () =>
      view.projectId
        ? { kind: "project", projectId: view.projectId }
        : { kind: "workspace" },
    [view.projectId],
  );
  const baseline = useMemo(() => viewToState(view), [view]);
  const handle = useTaskQueryState({
    storageScope: `view:${view.id}`,
    scope: scopeKind,
    workspaceId: view.workspaceId,
    baseline,
    allowedLayouts: VIEW_PAGE_LAYOUTS,
  });

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

  return (
    <TaskListSurface
      workspaceId={view.workspaceId}
      scope={scope}
      handle={handle}
      layouts={VIEW_PAGE_LAYOUTS}
      storageKey={`view:${view.id}`}
      showCount
      actions={
        <SaveViewActions
          workspaceId={view.workspaceId}
          projectId={view.projectId}
          handle={handle}
          view={view}
        />
      }
      taskId={taskId}
      onCloseTask={closeTask}
    />
  );
}
