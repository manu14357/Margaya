import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPageComment,
  deletePageComment,
  setPageSubscription,
  updatePageComment,
} from "@/fetchers/page/page-comments";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import type { PageSubscription } from "@/types/page";

// None of these can change a task, so the global task refresh stays off.
const meta = { refreshTaskQueries: false };

function useRefreshAfterComment(pageId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: pageQueryKeys.comments(pageId),
    });
    // Commenting starts watching the page.
    void queryClient.invalidateQueries({
      queryKey: pageQueryKeys.subscription(pageId),
    });
  };
}

export function useCreatePageComment(pageId: string) {
  const refresh = useRefreshAfterComment(pageId);
  return useMutation({
    meta,
    mutationFn: (content: string) => createPageComment(pageId, content),
    onSettled: refresh,
  });
}

export function useUpdatePageComment(pageId: string) {
  const refresh = useRefreshAfterComment(pageId);
  return useMutation({
    meta,
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: string;
      content: string;
    }) => updatePageComment(pageId, commentId, content),
    onSettled: refresh,
  });
}

export function useDeletePageComment(pageId: string) {
  const refresh = useRefreshAfterComment(pageId);
  return useMutation({
    meta,
    mutationFn: (commentId: string) => deletePageComment(pageId, commentId),
    onSettled: refresh,
  });
}

/** Watches or stops watching; optimistic, rolled back on failure. */
export function useTogglePageSubscription(pageId: string) {
  const queryClient = useQueryClient();
  const key = pageQueryKeys.subscription(pageId);
  return useMutation<
    PageSubscription,
    Error,
    boolean,
    { previous?: PageSubscription }
  >({
    meta,
    mutationFn: (watch) => setPageSubscription(pageId, watch),
    onMutate: async (watch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PageSubscription>(key);
      queryClient.setQueryData<PageSubscription>(key, {
        pageId,
        subscribed: watch,
      });
      return { previous };
    },
    onError: (_error, _watch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
