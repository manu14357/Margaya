import { useQuery } from "@tanstack/react-query";
import getTaskReactions from "@/fetchers/reaction/get-task-reactions";

export const taskReactionsKey = (taskId: string) =>
  ["reactions", taskId] as const;

/** One request serves the task's reaction bar and every comment's. */
function useTaskReactions(taskId: string | undefined) {
  return useQuery({
    queryKey: taskReactionsKey(taskId ?? ""),
    queryFn: () => getTaskReactions(taskId ?? ""),
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });
}

export default useTaskReactions;
