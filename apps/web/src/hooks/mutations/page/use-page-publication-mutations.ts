import { useMutation, useQueryClient } from "@tanstack/react-query";
import { publishPage, unpublishPage } from "@/fetchers/page/page-publication";
import { pagePublicationKey } from "@/hooks/queries/page/use-page-publication";

export function usePublishPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => publishPage(pageId),
    onSuccess: (state, pageId) =>
      queryClient.setQueryData(pagePublicationKey(pageId), state),
  });
}

/** Revokes the public link at once. */
export function useUnpublishPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => unpublishPage(pageId),
    onSuccess: (state, pageId) =>
      queryClient.setQueryData(pagePublicationKey(pageId), state),
  });
}
