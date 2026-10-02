import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import clearNotifications from "@/fetchers/notification/clear-notifications";
import { inboxQueryKeys } from "@/lib/inbox-cache";
import type { InboxPage } from "@/types/notification";

/** Deletes one workspace's notifications; its cached rows go at once. */
function useClearNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId?: string) => clearNotifications(workspaceId),
    onMutate: async (workspaceId) => {
      if (!workspaceId) return;
      await queryClient.cancelQueries({
        queryKey: inboxQueryKeys.inboxWorkspace(workspaceId),
      });
      queryClient.setQueriesData<InfiniteData<InboxPage>>(
        { queryKey: inboxQueryKeys.inboxWorkspace(workspaceId) },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              // Rows without a workspace are kept by the API.
              items: page.items.filter((row) => !row.workspaceId),
            })),
          },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all() });
    },
  });
}

export default useClearNotifications;
