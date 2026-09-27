import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Opens a task in the page's details sheet (`?taskId=`), or its full page in
 * a new tab with Cmd or Ctrl held. Clicking the open task again closes it.
 */
export function useTaskOpen(workspaceId: string) {
  const navigate = useNavigate();
  return useCallback(
    (
      task: { id: string; projectId: string },
      event?: { metaKey?: boolean; ctrlKey?: boolean },
    ) => {
      if (event?.metaKey || event?.ctrlKey) {
        window.open(
          `/dashboard/workspace/${workspaceId}/project/${task.projectId}/task/${task.id}`,
          "_blank",
          "noopener",
        );
        return;
      }
      const current = new URLSearchParams(window.location.search).get("taskId");
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          taskId: current === task.id ? undefined : task.id,
        }),
      });
    },
    [navigate, workspaceId],
  );
}
