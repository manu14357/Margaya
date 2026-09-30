import { useQuery } from "@tanstack/react-query";
import getModuleTaskIds from "@/fetchers/module/get-module-task-ids";
import { moduleQueryKeys } from "./module-query-keys";

// Module-level, so the query keeps one Set per response.
const toSet = (ids: string[]) => new Set(ids);

/** An archived module's visible task ids (the task map skips archived ones). */
export function useGetModuleTaskIds(
  projectId: string,
  moduleId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: moduleQueryKeys.taskIds(projectId, moduleId),
    queryFn: () => getModuleTaskIds(moduleId),
    enabled: Boolean(projectId && moduleId) && enabled,
    select: toSet,
  });
}

export default useGetModuleTaskIds;
