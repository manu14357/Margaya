import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  purgeWhiteboard,
  restoreDeletedWhiteboard,
} from "@/fetchers/trash/whiteboard-trash";
import { invalidateWhiteboardQueries } from "@/hooks/mutations/whiteboard/invalidate-whiteboard-queries";

const meta = { refreshTaskQueries: false };

/** The trash lists, the project's boards and the tasks' board lists. */
function useRefresh(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    invalidateWhiteboardQueries(queryClient, {
      projectId,
      trash: true,
      taskBoards: true,
    });
}

/** Restores a deleted board to the project's archived boards. */
export function useRestoreDeletedWhiteboard(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: restoreDeletedWhiteboard,
    onSettled: refresh,
  });
}

/** Deletes a board in the trash permanently. */
export function usePurgeWhiteboard(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: purgeWhiteboard,
    onSettled: refresh,
  });
}
