import { useQuery } from "@tanstack/react-query";
import {
  getMyProjectRights,
  type ProjectRights,
} from "@/fetchers/project/project-rights";

export const projectRightsQueryKey = (workspaceId: string) =>
  ["project-rights", workspaceId] as const;

const byProject = (rows: ProjectRights[]) =>
  new Map(rows.map((row) => [row.projectId, row]));

/**
 * My capping project roles in the workspace, by project id: one request for
 * every project and every row of a cross-project list. A project missing
 * from the map caps nothing. Refreshed when my access or a role changes.
 */
function useProjectRights(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: projectRightsQueryKey(workspaceId ?? ""),
    queryFn: () => getMyProjectRights(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
    select: byProject,
  });
}

export default useProjectRights;
