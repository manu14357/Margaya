import { useQuery } from "@tanstack/react-query";
import { getProjectAccess } from "@/fetchers/project/project-access";

export const projectAccessQueryKey = (projectId: string) =>
  ["project-access", projectId] as const;

/** A project's visibility and member list (restricted projects). */
function useProjectAccess(projectId: string) {
  return useQuery({
    queryKey: projectAccessQueryKey(projectId),
    queryFn: () => getProjectAccess(projectId),
    enabled: !!projectId,
  });
}

export default useProjectAccess;
