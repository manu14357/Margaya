import { useQuery } from "@tanstack/react-query";
import { listCalendarFeeds } from "@/fetchers/calendar-feed/calendar-feeds";

export const calendarFeedKeys = {
  all: ["calendar-feeds"] as const,
  workspace: (workspaceId: string) => ["calendar-feeds", workspaceId] as const,
};

/** The caller's own calendar feeds in a workspace. */
export default function useCalendarFeeds(workspaceId: string | undefined) {
  return useQuery({
    queryKey: calendarFeedKeys.workspace(workspaceId ?? ""),
    queryFn: () => listCalendarFeeds(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });
}
