import { useQuery } from "@tanstack/react-query";
import getInboxCounts from "@/fetchers/notification/get-inbox-counts";
import { inboxQueryKeys } from "@/lib/inbox-cache";

/** Unread counts of a workspace's Inbox view (every type, and mentions). */
function useInboxCounts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: inboxQueryKeys.counts(workspaceId ?? ""),
    queryFn: () => getInboxCounts(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export default useInboxCounts;
