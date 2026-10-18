import { useQuery } from "@tanstack/react-query";
import getTaskTemplates from "@/fetchers/task-template/get-task-templates";
import { taskTemplateQueryKeys } from "./task-template-query-keys";

/** A project's task templates; nothing is fetched without both ids. */
export function useTaskTemplates(
  workspaceId: string,
  projectId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: taskTemplateQueryKeys.list(workspaceId, projectId),
    queryFn: () => getTaskTemplates(projectId),
    enabled: enabled && Boolean(workspaceId && projectId),
    // Templates change rarely; a realtime hint refreshes them when they do.
    staleTime: 60_000,
  });
}

export default useTaskTemplates;
