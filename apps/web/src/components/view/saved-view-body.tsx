import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import TaskListSurface from "@/components/task-layouts/task-list-surface";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import type { TaskLayout, TaskQueryScope } from "@/lib/task-query/model";
import {
  PROJECT_VIEW_LAYOUTS,
  viewScopeOf,
  viewToState,
  WORKSPACE_VIEW_LAYOUTS,
} from "@/lib/task-query/view-state";
import type { SavedView } from "@/types/view";
import SaveViewActions from "./save-view-actions";

/**
 * The layouts a view page offers: a project's view also has its Calendar and
 * Gantt; a workspace view spans projects, so it keeps to the task lists.
 */
export function viewPageLayouts(
  view: Pick<SavedView, "projectId">,
): readonly TaskLayout[] {
  return view.projectId ? PROJECT_VIEW_LAYOUTS : WORKSPACE_VIEW_LAYOUTS;
}

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
  const layouts = viewPageLayouts(view);
  const handle = useTaskQueryState({
    storageScope: `view:${view.id}`,
    scope: scopeKind,
    workspaceId: view.workspaceId,
    baseline,
    allowedLayouts: layouts,
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
      layouts={layouts}
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
