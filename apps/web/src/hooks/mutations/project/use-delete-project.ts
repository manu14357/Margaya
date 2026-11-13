import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteProject from "@/fetchers/project/delete-project";
import { invalidateProjectListQueries } from "./invalidate-project-list-queries";

function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    // The trashed project leaves lists, favorites and recents, and joins
    // the trash.
    onSuccess: () => invalidateProjectListQueries(queryClient),
  });
}

export default useDeleteProject;
