import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskAssignees, {
  type TaskAssigneesPatch,
} from "@/fetchers/task/update-task-assignees";
import { patchAssigneeIds, revertAssigneePatch } from "@/lib/task-assignees";
import {
  cancelTaskQueries,
  invalidateAssigneeQueries,
  readCachedAssigneeIds,
  syncTaskAssigneesInCaches,
  type TaskAssigneesTarget,
} from "./sync-task-assignees-cache";

export type UpdateTaskAssigneesInput = TaskAssigneesTarget & TaskAssigneesPatch;

type Context = { previous?: readonly string[] };

/**
 * Adds and/or removes assignees, keeping the others. Optimistic: a failure
 * undoes only this request's change, so concurrent toggles survive it.
 */
export function useUpdateTaskAssignees() {
  const queryClient = useQueryClient();

  return useMutation<
    Awaited<ReturnType<typeof updateTaskAssignees>>,
    Error,
    UpdateTaskAssigneesInput,
    Context
  >({
    mutationFn: ({ taskId, add, remove }) =>
      updateTaskAssignees(taskId, { add, remove }),
    onMutate: async (input) => {
      await cancelTaskQueries(queryClient, input);
      const previous = readCachedAssigneeIds(queryClient, input);
      syncTaskAssigneesInCaches(queryClient, input, (ids) =>
        patchAssigneeIds(ids, input),
      );
      return { previous };
    },
    onError: (_error, input, context) => {
      const previous = context?.previous;
      if (!previous) return;
      syncTaskAssigneesInCaches(queryClient, input, (ids) =>
        revertAssigneePatch(ids, previous, input),
      );
    },
    onSettled: (_data, _error, input) => {
      invalidateAssigneeQueries(queryClient, input);
    },
  });
}

export default useUpdateTaskAssignees;
