import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import updateProject from "@/fetchers/project/update-project";

type SavedProject = Awaited<ReturnType<typeof updateProject>>;
type ProjectFields = Pick<
  SavedProject,
  | "name"
  | "slug"
  | "description"
  | "icon"
  | "isPublic"
  | "leadUserId"
  | "defaultAssigneeUserId"
>;

function patchProject<T>(cached: T, id: string, fields: ProjectFields): T {
  if (!cached || typeof cached !== "object") return cached;
  if ((cached as { id?: unknown }).id !== id) return cached;
  return { ...cached, ...fields };
}

/**
 * Writes a saved project into every cached copy (the workspace list, the
 * detail query and the board's project-with-tasks), so the next edit starts
 * from what the server holds instead of an older snapshot.
 */
export function syncSavedProject(
  queryClient: QueryClient,
  project: SavedProject,
) {
  const fields: ProjectFields = {
    name: project.name,
    slug: project.slug,
    description: project.description,
    icon: project.icon,
    isPublic: project.isPublic,
    leadUserId: project.leadUserId,
    defaultAssigneeUserId: project.defaultAssigneeUserId,
  };
  queryClient.setQueryData(
    ["projects", project.workspaceId, project.id],
    (cached: unknown) => patchProject(cached, project.id, fields),
  );
  queryClient.setQueryData(
    ["projects", project.workspaceId],
    (cached: unknown) =>
      Array.isArray(cached)
        ? cached.map((item) => patchProject(item, project.id, fields))
        : cached,
  );
  queryClient.setQueryData(["tasks", project.id], (cached: unknown) =>
    patchProject(cached, project.id, fields),
  );
}

function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProject,
    onSuccess: (project) => {
      syncSavedProject(queryClient, project);
      // Refetching also cancels any older request still in flight, so a
      // response from before the save can't overwrite the fresh copy.
      void queryClient.invalidateQueries({
        queryKey: ["projects", project.workspaceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["tasks", project.id],
        exact: true,
      });
    },
  });
}

export default useUpdateProject;
