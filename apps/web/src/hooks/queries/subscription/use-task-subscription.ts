import { useQuery } from "@tanstack/react-query";
import getTaskSubscription from "@/fetchers/subscription/get-task-subscription";

export const taskSubscriptionKey = (taskId: string) =>
  ["task-subscription", taskId] as const;

/** Whether I watch the task, why, and how many people watch it. */
function useTaskSubscription(taskId: string | undefined) {
  return useQuery({
    queryKey: taskSubscriptionKey(taskId ?? ""),
    queryFn: () => getTaskSubscription(taskId ?? ""),
    enabled: Boolean(taskId),
    staleTime: 60_000,
  });
}

export default useTaskSubscription;
