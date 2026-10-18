import { useQuery } from "@tanstack/react-query";
import getTaskRecurrence from "@/fetchers/task-recurrence/get-task-recurrence";

// Under ["task", taskId], so the TASK_UPDATED hint that a repeat change sends
// (and every other task update) refreshes it.
export const taskRecurrenceQueryKey = (taskId: string) =>
  ["task", taskId, "recurrence"] as const;

/** A task's repeat rule (null when it does not repeat). */
export function useTaskRecurrence(taskId: string | undefined) {
  return useQuery({
    queryKey: taskRecurrenceQueryKey(taskId ?? ""),
    queryFn: async () => (await getTaskRecurrence(taskId ?? "")).recurrence,
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });
}

export default useTaskRecurrence;
