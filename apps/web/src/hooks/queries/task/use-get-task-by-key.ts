import { useQuery } from "@tanstack/react-query";
import getTaskByKey from "@/fetchers/task/get-task-by-key";

/** The task a readable key points at; a 404 is an answer, not a retry. */
function useGetTaskByKey(workspaceId: string, key: string) {
  return useQuery({
    queryKey: ["task-by-key", workspaceId, key.toUpperCase()],
    queryFn: () => getTaskByKey(workspaceId, key),
    enabled: Boolean(workspaceId && key),
    retry: false,
  });
}

export default useGetTaskByKey;
