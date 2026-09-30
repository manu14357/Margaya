import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import getModuleTaskMap from "@/fetchers/module/get-module-task-map";
import type { ModuleTaskMapEntry } from "@/types/module";
import { moduleQueryKeys } from "./module-query-keys";

export type ModuleTaskIndex = {
  /** Task id → the active modules it is in. */
  modulesByTask: ReadonlyMap<string, readonly string[]>;
  /** Module id → its task ids. */
  tasksByModule: ReadonlyMap<string, ReadonlySet<string>>;
};

const EMPTY_INDEX: ModuleTaskIndex = {
  modulesByTask: new Map(),
  tasksByModule: new Map(),
};

export function buildModuleTaskIndex(
  entries: readonly ModuleTaskMapEntry[],
): ModuleTaskIndex {
  const modulesByTask = new Map<string, string[]>();
  const tasksByModule = new Map<string, Set<string>>();
  for (const { taskId, moduleId } of entries) {
    const modules = modulesByTask.get(taskId);
    if (modules) modules.push(moduleId);
    else modulesByTask.set(taskId, [moduleId]);
    const tasks = tasksByModule.get(moduleId);
    if (tasks) tasks.add(taskId);
    else tasksByModule.set(moduleId, new Set([taskId]));
  }
  return { modulesByTask, tasksByModule };
}

// Every card on a board reads the same map; building the index once per
// response keeps a board of hundreds of cards from rebuilding it per card.
const indexes = new WeakMap<readonly ModuleTaskMapEntry[], ModuleTaskIndex>();

export function moduleTaskIndexOf(
  entries: readonly ModuleTaskMapEntry[],
): ModuleTaskIndex {
  let index = indexes.get(entries);
  if (!index) {
    index = buildModuleTaskIndex(entries);
    indexes.set(entries, index);
  }
  return index;
}

/** (task, module) pairs of the project's active modules. */
export function useGetModuleTaskMap(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: moduleQueryKeys.taskMap(projectId),
    queryFn: () => getModuleTaskMap(projectId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30_000,
  });
}

/**
 * The task map as lookups. Pass `enabled: false` while the modules feature
 * is off or nothing needs it: the maps are then empty and nothing is fetched.
 * `isReady` says the maps reflect the server.
 */
export function useModuleTaskIndex(
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
): ModuleTaskIndex & { isReady: boolean } {
  const { data, isSuccess } = useGetModuleTaskMap(projectId, { enabled });
  const index = enabled && data ? moduleTaskIndexOf(data) : EMPTY_INDEX;
  const isReady = enabled && isSuccess;
  return useMemo(() => ({ ...index, isReady }), [index, isReady]);
}

export default useGetModuleTaskMap;
