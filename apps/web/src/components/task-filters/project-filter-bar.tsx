import { type ReactNode, useMemo } from "react";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import type { TaskQueryScope } from "@/lib/task-query/model";
import TaskToolbar, { type TaskToolbarStatus } from "./task-toolbar";

type ProjectFilterBarProps = {
  workspaceId: string;
  projectId: string;
  handle: TaskQueryStateHandle;
  status?: TaskToolbarStatus;
  /** The view's own controls on the right (the calendar's month). */
  trailing?: ReactNode;
};

/**
 * Filters only, for Calendar and Gantt: they have their own time controls,
 * so grouping, ordering and archived tasks don't apply.
 */
export default function ProjectFilterBar({
  workspaceId,
  projectId,
  handle,
  status,
  trailing,
}: ProjectFilterBarProps) {
  const scope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  return (
    <TaskToolbar
      workspaceId={workspaceId}
      scope={scope}
      handle={handle}
      displayConfig={null}
      showArchived={false}
      status={status}
      rightSlot={trailing}
    />
  );
}
