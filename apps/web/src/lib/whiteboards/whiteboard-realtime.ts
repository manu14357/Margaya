import type { QueryClient } from "@tanstack/react-query";
import { invalidateWhiteboardQueries } from "@/hooks/mutations/whiteboard/invalidate-whiteboard-queries";

type WhiteboardHint = {
  type?: unknown;
  projectId?: unknown;
  whiteboardId?: unknown;
};

/** The project socket's hint for any board change (ids only, no content). */
export const WHITEBOARD_CHANGED = "whiteboard.changed";

/**
 * Applies a `whiteboard.changed` hint: the project's lists, the board's
 * header, stored copy and history, the trash and the tasks' board lists refetch
 * (only mounted queries do). Open boards get their content over their own
 * socket. Returns false for any other message.
 */
export function handleWhiteboardHint(
  queryClient: QueryClient,
  message: WhiteboardHint,
): boolean {
  if (message.type !== WHITEBOARD_CHANGED) return false;
  const projectId =
    typeof message.projectId === "string" ? message.projectId : null;
  const whiteboardId =
    typeof message.whiteboardId === "string" ? message.whiteboardId : null;
  // The hint doesn't say what changed: a rename, a save (new task cards), a
  // trash or a restore all look the same.
  invalidateWhiteboardQueries(queryClient, {
    projectId,
    whiteboardId,
    trash: true,
    taskBoards: true,
  });
  return true;
}
