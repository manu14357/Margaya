import { useQuery } from "@tanstack/react-query";
import getProjectDependencies from "@/fetchers/task-relation/get-project-dependencies";

/**
 * Under the "task-relations" prefix, so every broad relation refresh (bulk
 * task changes, the relation hint) reaches the timeline too.
 */
export function projectDependenciesQueryKey(projectId: string) {
  return ["task-relations", "project", projectId] as const;
}

export function useGetProjectDependencies(projectId: string) {
  return useQuery({
    queryKey: projectDependenciesQueryKey(projectId),
    queryFn: () => getProjectDependencies(projectId),
    enabled: !!projectId,
  });
}
