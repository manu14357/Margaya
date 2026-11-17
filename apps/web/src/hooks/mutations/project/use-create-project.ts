import { useMutation } from "@tanstack/react-query";
import createProject, {
  type CreateProjectRequest,
} from "@/fetchers/project/create-project";

/**
 * Creates a project. The request comes either from the hook's argument (the
 * older call sites) or from `mutate(request)`.
 */
function useCreateProject(defaults?: CreateProjectRequest) {
  return useMutation({
    mutationFn: (request?: CreateProjectRequest) => {
      const body = request ?? defaults;
      if (!body) throw new Error("Missing project request");
      return createProject(body);
    },
    meta: { refreshTaskQueries: false },
  });
}

export default useCreateProject;
