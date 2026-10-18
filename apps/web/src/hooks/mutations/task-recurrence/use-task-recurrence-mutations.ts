import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import removeTaskRecurrence from "@/fetchers/task-recurrence/remove-task-recurrence";
import setTaskRecurrence, {
  type SetTaskRecurrenceBody,
} from "@/fetchers/task-recurrence/set-task-recurrence";
import { taskRecurrenceQueryKey } from "@/hooks/queries/task-recurrence/use-task-recurrence";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

type Target = { taskId: string; projectId: string };

/** Cards and rows show the repeat icon; the history gains a line. */
function refreshAfterChange(
  queryClient: QueryClient,
  { taskId, projectId }: Target,
) {
  void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  void queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
  void invalidateTaskQueries(queryClient, projectId);
}

export function useSetTaskRecurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, body }: Target & { body: SetTaskRecurrenceBody }) =>
      setTaskRecurrence(taskId, body),
    onSuccess: (result, target) => {
      queryClient.setQueryData(
        taskRecurrenceQueryKey(target.taskId),
        result.recurrence,
      );
      refreshAfterChange(queryClient, target);
    },
  });
}

export function useRemoveTaskRecurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId }: Target) => removeTaskRecurrence(taskId),
    onSuccess: (_result, target) => {
      queryClient.setQueryData(taskRecurrenceQueryKey(target.taskId), null);
      refreshAfterChange(queryClient, target);
    },
  });
}
