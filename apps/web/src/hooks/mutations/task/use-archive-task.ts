import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import archiveTask from "@/fetchers/task/archive-task";
import unarchiveTask from "@/fetchers/task/unarchive-task";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { scheduleBoardRefresh } from "@/lib/board-cache";
import { invalidateTaskQueries } from "@/lib/task-query/cache";
import { boardTaskEdit } from "./board-task-edit";

type ArchiveVariables = {
  taskId: string;
  projectId: string;
  /** true archives the task in its column, false restores it. */
  archived: boolean;
};

/** The lists, boards and counts an archive or restore changes. */
export function invalidateAfterArchive(
  queryClient: QueryClient,
  taskId: string,
  projectId: string,
) {
  scheduleBoardRefresh(queryClient, projectId);
  for (const queryKey of [
    ["task", taskId],
    ["activities", taskId],
    ["projects"],
    ["cycles", projectId],
    ["modules", projectId],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  // Archived tasks leave forecasts and risks.
  invalidateDeliveryQueries(queryClient, projectId);
  void invalidateTaskQueries(queryClient, projectId);
}

/**
 * Archives or restores one task (D7): archived tasks keep their column and
 * position, and leave the board until restored.
 */
export function useArchiveTask() {
  const queryClient = useQueryClient();
  const board = boardTaskEdit<unknown, ArchiveVariables>(
    queryClient,
    ({ taskId, projectId, archived }) => ({
      projectId,
      taskId,
      patch: { archivedAt: archived ? new Date().toISOString() : null },
    }),
  );

  return useMutation({
    mutationFn: ({ taskId, archived }: ArchiveVariables) =>
      archived ? archiveTask(taskId) : unarchiveTask(taskId),
    onMutate: board.onMutate,
    onSuccess: (task, { taskId, projectId }, context) => {
      board.onSaved(task, context);
      invalidateAfterArchive(queryClient, taskId, projectId);
    },
    onError: (_error, _variables, context) => board.onFailed(context),
  });
}

export default useArchiveTask;
