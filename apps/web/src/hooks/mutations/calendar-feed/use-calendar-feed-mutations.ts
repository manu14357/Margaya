import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createProjectCalendarFeed,
  createWorkspaceCalendarFeed,
  revokeCalendarFeed,
} from "@/fetchers/calendar-feed/calendar-feeds";
import { calendarFeedKeys } from "@/hooks/queries/calendar-feed/use-calendar-feeds";

// Feeds are personal settings: no other client shows them, so a refetch of
// the caller's own list is the whole cache story.

function useInvalidateFeeds() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: calendarFeedKeys.all });
}

export function useCreateWorkspaceCalendarFeed() {
  const invalidate = useInvalidateFeeds();
  return useMutation({
    mutationFn: createWorkspaceCalendarFeed,
    meta: { refreshTaskQueries: false },
    onSuccess: () => invalidate(),
  });
}

export function useCreateProjectCalendarFeed() {
  const invalidate = useInvalidateFeeds();
  return useMutation({
    mutationFn: createProjectCalendarFeed,
    meta: { refreshTaskQueries: false },
    onSuccess: () => invalidate(),
  });
}

export function useRevokeCalendarFeed() {
  const invalidate = useInvalidateFeeds();
  return useMutation({
    mutationFn: revokeCalendarFeed,
    meta: { refreshTaskQueries: false },
    onSuccess: () => invalidate(),
  });
}
