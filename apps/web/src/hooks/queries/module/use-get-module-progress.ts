import { useQuery } from "@tanstack/react-query";
import getModuleProgress from "@/fetchers/module/get-module-progress";
import { moduleQueryKeys } from "./module-query-keys";

export function useGetModuleProgress(
  projectId: string,
  moduleId: string | undefined,
) {
  return useQuery({
    queryKey: moduleQueryKeys.progress(projectId, moduleId ?? ""),
    queryFn: () => getModuleProgress(moduleId ?? ""),
    enabled: Boolean(projectId && moduleId),
  });
}

export default useGetModuleProgress;
