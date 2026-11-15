import type { QueryClient } from "@tanstack/react-query";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { whiteboardQueryKeys } from "@/hooks/queries/whiteboard/whiteboard-query-keys";

type Options = {
  /** Every list filter of this project, and the workspace lists, refresh. */
  projectId?: string | null;
  /** One board's header data, stored content and history. */
  whiteboardId?: string | null;
  /** The project trash (a board moved there, restored or purged). */
  trash?: boolean;
  /** The "On whiteboards" lists of tasks (content, trash and deletes). */
  taskBoards?: boolean;
};

/** Refreshes whiteboard queries after a change; only mounted ones refetch. */
export function invalidateWhiteboardQueries(
  queryClient: QueryClient,
  { projectId, whiteboardId, trash, taskBoards }: Options,
) {
  if (projectId) {
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.projectLists(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.workspaceLists(),
    });
  }
  if (whiteboardId) {
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.detail(whiteboardId),
    });
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.content(whiteboardId),
    });
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.activity(whiteboardId),
    });
  }
  if (trash) {
    void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
  }
  if (taskBoards) {
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.taskBoards(),
    });
  }
}
