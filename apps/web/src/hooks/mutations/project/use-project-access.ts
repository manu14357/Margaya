import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addProjectMember,
  type ProjectAccess,
  type ProjectVisibility,
  removeProjectMember,
  updateProjectMemberRole,
  updateProjectVisibility,
} from "@/fetchers/project/project-access";
import { projectAccessQueryKey } from "@/hooks/queries/project/use-project-access";
import { projectAudienceQueryKey } from "@/hooks/queries/project/use-project-audience";

type Change =
  | { kind: "visibility"; visibility: ProjectVisibility }
  | { kind: "add"; userId: string; role: string }
  | { kind: "role"; userId: string; role: string }
  | { kind: "remove"; userId: string };

/**
 * Changes a project's access. The answer is the new access state; who can
 * see which projects changes too, so project lists, favourites and task
 * queries refetch.
 */
function useProjectAccessMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProjectAccess, Error, Change>({
    mutationFn: (change) => {
      switch (change.kind) {
        case "visibility":
          return updateProjectVisibility(projectId, change.visibility);
        case "add":
          return addProjectMember(projectId, change.userId, change.role);
        case "role":
          return updateProjectMemberRole(projectId, change.userId, change.role);
        case "remove":
          return removeProjectMember(projectId, change.userId);
      }
    },
    onSuccess: (access) => {
      queryClient.setQueryData(projectAccessQueryKey(projectId), access);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Who its pickers offer, and my own role there if I changed it.
      queryClient.invalidateQueries({
        queryKey: projectAudienceQueryKey(projectId),
      });
      queryClient.invalidateQueries({ queryKey: ["project-rights"] });
    },
  });
}

export default useProjectAccessMutation;
