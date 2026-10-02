import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import markAllNotificationsAsRead, {
  type MarkAllReadScope,
} from "@/fetchers/notification/mark-all-notifications-as-read";
import { filtersOfKey, inboxQueryKeys } from "@/lib/inbox-cache";
import type { InboxCounts, InboxPage } from "@/types/notification";

type Context = { snapshot: Array<[QueryKey, unknown]> };

function sameTypes(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((type) => b.includes(type));
}

/**
 * Marks the scope's notifications read (every notification without one).
 * Optimistic: matching cached rows turn read and the matching count drops
 * to zero.
 */
function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation<
    Awaited<ReturnType<typeof markAllNotificationsAsRead>>,
    Error,
    MarkAllReadScope | undefined,
    Context
  >({
    mutationFn: (scope) => markAllNotificationsAsRead(scope),
    onMutate: async (scope) => {
      await queryClient.cancelQueries({ queryKey: inboxQueryKeys.all() });
      const snapshot = queryClient.getQueriesData({
        queryKey: inboxQueryKeys.all(),
      });
      if (!scope) return { snapshot };

      for (const [key, data] of queryClient.getQueriesData<
        InfiniteData<InboxPage>
      >({ queryKey: inboxQueryKeys.inboxWorkspace(scope.workspaceId) })) {
        const filters = filtersOfKey(key);
        if (!filters || !data || filters.view !== scope.view) continue;
        if (scope.types.length > 0 && !sameTypes(filters.types, scope.types)) {
          continue;
        }
        queryClient.setQueryData<InfiniteData<InboxPage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) =>
              scope.tab === "all" || row.type === "task_mention"
                ? { ...row, isRead: true }
                : row,
            ),
          })),
        });
      }

      if (scope.view === "inbox" && scope.types.length === 0) {
        queryClient.setQueryData<InboxCounts>(
          inboxQueryKeys.counts(scope.workspaceId),
          (counts) =>
            counts &&
            (scope.tab === "all"
              ? { ...counts, unread: 0, unreadMentions: 0 }
              : {
                  ...counts,
                  unread: Math.max(0, counts.unread - counts.unreadMentions),
                  unreadMentions: 0,
                }),
        );
      }

      return { snapshot };
    },
    onError: (_error, _scope, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all() });
    },
  });
}

export default useMarkAllNotificationsAsRead;
