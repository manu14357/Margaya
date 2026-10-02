import { useInfiniteQuery } from "@tanstack/react-query";
import getInbox from "@/fetchers/notification/get-inbox";
import { inboxQueryKeys } from "@/lib/inbox-cache";
import type { InboxFilters } from "@/types/notification";

export const INBOX_PAGE_SIZE = 50;

type UseInboxNotificationsInput = InboxFilters & {
  workspaceId: string | undefined;
  /** 50 for the inbox page; the dropdown reads one page of 20. */
  pageSize?: number;
};

/** One workspace's inbox, paged by the API's keyset cursor. */
function useInboxNotifications({
  workspaceId,
  tab,
  view,
  unread,
  types,
  pageSize = INBOX_PAGE_SIZE,
}: UseInboxNotificationsInput) {
  const filters = { tab, view, unread, types, limit: pageSize };

  return useInfiniteQuery({
    queryKey: inboxQueryKeys.inbox(workspaceId ?? "", filters),
    queryFn: ({ pageParam }) =>
      getInbox({
        workspaceId: workspaceId ?? "",
        ...filters,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export default useInboxNotifications;
