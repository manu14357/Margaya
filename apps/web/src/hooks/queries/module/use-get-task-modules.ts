import { useQuery } from "@tanstack/react-query";
import getTaskModules from "@/fetchers/module/get-task-modules";
import { moduleQueryKeys } from "./module-query-keys";

/** The task's active modules, by name. */
export function useGetTaskModules(
  projectId: string,
  taskId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: moduleQueryKeys.task(projectId, taskId),
    queryFn: () => getTaskModules(taskId),
    enabled: Boolean(projectId && taskId) && enabled,
  });
}

export default useGetTaskModules;
