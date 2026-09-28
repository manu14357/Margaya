import { useQuery } from "@tanstack/react-query";
import getTaskLinks from "@/fetchers/task-link/get-task-links";

export const taskLinksQueryKey = (taskId: string) =>
  ["task-links", taskId] as const;

/** The task's web links, newest first. */
function useGetTaskLinks(taskId: string) {
  return useQuery({
    queryKey: taskLinksQueryKey(taskId),
    queryFn: () => getTaskLinks(taskId),
    enabled: Boolean(taskId),
  });
}

export default useGetTaskLinks;
