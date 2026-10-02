import { useMutation, useQueryClient } from "@tanstack/react-query";
import createQuickLink, {
  type CreateQuickLinkRequest,
} from "@/fetchers/quick-link/create-quick-link";
import deleteQuickLink from "@/fetchers/quick-link/delete-quick-link";
import updateQuickLink, {
  type QuickLinkChanges,
} from "@/fetchers/quick-link/update-quick-link";
import {
  type QuickLink,
  quickLinksQueryKey,
} from "@/hooks/queries/quick-link/use-get-quick-links";

const meta = { refreshTaskQueries: false };

/** Adds a link; the server's normalized row goes on top once saved. */
export function useCreateQuickLink() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (request: CreateQuickLinkRequest) => createQuickLink(request),
    onSuccess: (link, { workspaceId }) => {
      queryClient.setQueryData<QuickLink[]>(
        quickLinksQueryKey(workspaceId),
        (current) => [link, ...(current ?? []).filter((l) => l.id !== link.id)],
      );
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: quickLinksQueryKey(workspaceId),
      });
    },
  });
}

type UpdateVariables = {
  workspaceId: string;
  quickLinkId: string;
  changes: QuickLinkChanges;
};

export function useUpdateQuickLink() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (variables: UpdateVariables) => updateQuickLink(variables),
    onSuccess: (link, { workspaceId }) => {
      queryClient.setQueryData<QuickLink[]>(
        quickLinksQueryKey(workspaceId),
        (current) => current?.map((l) => (l.id === link.id ? link : l)),
      );
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: quickLinksQueryKey(workspaceId),
      });
    },
  });
}

type DeleteVariables = { workspaceId: string; quickLinkId: string };

/** Removes the link at once and restores it if the server refuses. */
export function useDeleteQuickLink() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (variables: DeleteVariables) => deleteQuickLink(variables),
    onMutate: async ({ workspaceId, quickLinkId }) => {
      const queryKey = quickLinksQueryKey(workspaceId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<QuickLink[]>(queryKey);
      queryClient.setQueryData<QuickLink[]>(queryKey, (current) =>
        current?.filter((link) => link.id !== quickLinkId),
      );
      return { previous };
    },
    onError: (_error, { workspaceId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          quickLinksQueryKey(workspaceId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: quickLinksQueryKey(workspaceId),
      });
    },
  });
}
