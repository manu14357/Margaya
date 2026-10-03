import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  publishProject,
  rotateProjectPublicationLink,
  unpublishProject,
  updateProjectPublication,
} from "@/fetchers/publication/project-publication";
import { publicationKeys } from "@/hooks/queries/publication/use-publication";
import { applyPublicationPatch } from "@/lib/publication/settings";
import type {
  ProjectPublication,
  PublicationSettingsPatch,
} from "@/types/publication";

const meta = { refreshTaskQueries: false };

/** The answer is the new publication; the project's isPublic mirror moved too. */
function storePublication(
  queryClient: QueryClient,
  projectId: string,
  publication: ProjectPublication,
) {
  queryClient.setQueryData(publicationKeys.publication(projectId), publication);
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
}

/** Publish, unpublish and rotate the link of a project's public board. */
export function usePublicationActions(projectId: string) {
  const queryClient = useQueryClient();
  const onSuccess = (publication: ProjectPublication) =>
    storePublication(queryClient, projectId, publication);

  const publish = useMutation({
    mutationFn: () => publishProject(projectId),
    onSuccess,
    meta,
  });
  const unpublish = useMutation({
    mutationFn: () => unpublishProject(projectId),
    onSuccess,
    meta,
  });
  const rotate = useMutation({
    mutationFn: () => rotateProjectPublicationLink(projectId),
    onSuccess,
    meta,
  });

  return { publish, unpublish, rotate };
}

type Context = { previous?: ProjectPublication };

/**
 * One board setting, saved as soon as it changes: optimistic, rolled back
 * on failure (the caller shows the toast).
 */
export function useUpdatePublication(projectId: string) {
  const queryClient = useQueryClient();
  const key = publicationKeys.publication(projectId);

  return useMutation<
    ProjectPublication,
    Error,
    PublicationSettingsPatch,
    Context
  >({
    mutationFn: (patch) => updateProjectPublication(projectId, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectPublication>(key);
      if (previous) {
        queryClient.setQueryData(key, applyPublicationPatch(previous, patch));
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (publication) =>
      storePublication(queryClient, projectId, publication),
    meta,
  });
}
