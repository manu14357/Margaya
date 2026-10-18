import { useMutation } from "@tanstack/react-query";
import createProject, {
  type CreateProjectRequest,
} from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  fromProjectId,
  copy,
  visibility,
}: CreateProjectRequest) {
  return useMutation({
    mutationFn: () =>
      createProject({
        name,
        slug,
        workspaceId,
        icon,
        fromProjectId,
        copy,
        visibility,
      }),
  });
}

export default useCreateProject;
