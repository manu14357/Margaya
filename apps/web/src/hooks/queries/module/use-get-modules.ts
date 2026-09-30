import { useQuery } from "@tanstack/react-query";
import getModules from "@/fetchers/module/get-modules";
import type { ModuleListView } from "@/types/module";
import { moduleQueryKeys } from "./module-query-keys";

/** Cards, pickers and chips share this list, so it stays fresh for 30 s. */
export const MODULE_LIST_STALE_TIME = 30_000;

export function useGetModules(
  projectId: string,
  view: ModuleListView = "active",
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: moduleQueryKeys.list(projectId, view),
    queryFn: () => getModules(projectId, view),
    enabled: Boolean(projectId) && enabled,
    staleTime: MODULE_LIST_STALE_TIME,
  });
}

export default useGetModules;
