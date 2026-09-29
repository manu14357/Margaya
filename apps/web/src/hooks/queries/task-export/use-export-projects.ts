import { useQuery } from "@tanstack/react-query";
import getExportProjects from "@/fetchers/task-export/get-export-projects";
import { taskExportQueryKeys } from "./task-export-query-keys";

/** The export form's project choices, archived projects included. */
export function useExportProjects(
  workspaceId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: taskExportQueryKeys.projects(workspaceId ?? ""),
    queryFn: () => getExportProjects(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export default useExportProjects;
