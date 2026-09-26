import { useMutation, useQueryClient } from "@tanstack/react-query";
import type getProject from "@/fetchers/project/get-project";
import type getProjects from "@/fetchers/project/get-projects";
import updateProjectFeatures, {
  type UpdateProjectFeaturesRequest,
} from "@/fetchers/project/update-project-features";

type ProjectDetail = Awaited<ReturnType<typeof getProject>>;
type ProjectList = NonNullable<Awaited<ReturnType<typeof getProjects>>>;

type Variables = {
  projectId: string;
  workspaceId: string;
  features: UpdateProjectFeaturesRequest;
};

type Context = {
  previousProject?: ProjectDetail;
  previousProjects?: ProjectList;
};

/** Optimistic: the switch moves at once and rolls back if the save fails. */
function useUpdateProjectFeatures() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, Variables, Context>({
    mutationFn: ({ projectId, features }) =>
      updateProjectFeatures(projectId, features),
    onMutate: async ({ projectId, workspaceId, features }) => {
      const detailKey = ["projects", workspaceId, projectId];
      const listKey = ["projects", workspaceId];
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
        queryClient.cancelQueries({ queryKey: listKey, exact: true }),
      ]);

      const previousProject =
        queryClient.getQueryData<ProjectDetail>(detailKey);
      const previousProjects = queryClient.getQueryData<ProjectList>(listKey);

      if (previousProject) {
        queryClient.setQueryData<ProjectDetail>(detailKey, {
          ...previousProject,
          ...features,
        });
      }
      if (previousProjects) {
        queryClient.setQueryData<ProjectList>(
          listKey,
          previousProjects.map((project) =>
            project.id === projectId ? { ...project, ...features } : project,
          ),
        );
      }

      return { previousProject, previousProjects };
    },
    onError: (_error, { projectId, workspaceId }, context) => {
      if (context?.previousProject) {
        queryClient.setQueryData(
          ["projects", workspaceId, projectId],
          context.previousProject,
        );
      }
      if (context?.previousProjects) {
        queryClient.setQueryData(
          ["projects", workspaceId],
          context.previousProjects,
        );
      }
    },
    onSettled: (_data, _error, { projectId, workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId, projectId],
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId],
        exact: true,
      });
    },
  });
}

export default useUpdateProjectFeatures;
