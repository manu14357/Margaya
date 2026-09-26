import { useMutation, useQueryClient } from "@tanstack/react-query";
import setTaskAssignees from "@/fetchers/task/set-task-assignees";
import {
  cancelTaskQueries,
  invalidateAssigneeQueries,
  readCachedAssigneeIds,
  syncTaskAssigneesInCaches,
  type TaskAssigneesTarget,
} from "./sync-task-assignees-cache";

export type SetTaskAssigneesInput = TaskAssigneesTarget & {
  /** The complete ordered list; [] unassigns everyone. */
  assigneeIds: string[];
};

type Context = { previous?: readonly string[] };

/** Replaces a task's assignees; optimistic, restored on failure. */
export function useSetTaskAssignees() {
  const queryClient = useQueryClient();

  return useMutation<
    Awaited<ReturnType<typeof setTaskAssignees>>,
    Error,
    SetTaskAssigneesInput,
    Context
  >({
    mutationFn: ({ taskId, assigneeIds }) =>
      setTaskAssignees(taskId, assigneeIds),
    onMutate: async (input) => {
      await cancelTaskQueries(queryClient, input);
      const previous = readCachedAssigneeIds(queryClient, input);
      syncTaskAssigneesInCaches(queryClient, input, (ids) => {
        // People who stay keep their order; new people are appended.
        const staying = ids.filter((id) => input.assigneeIds.includes(id));
        return [
          ...staying,
          ...input.assigneeIds.filter((id) => !staying.includes(id)),
        ];
      });
      return { previous };
    },
    onError: (_error, input, context) => {
      const previous = context?.previous;
      if (!previous) return;
      syncTaskAssigneesInCaches(queryClient, input, () => previous);
    },
    onSettled: (_data, _error, input) => {
      invalidateAssigneeQueries(queryClient, input);
    },
  });
}

export default useSetTaskAssignees;
