import { useQuery } from "@tanstack/react-query";
import { listWorkspaceWhiteboards } from "@/fetchers/whiteboard/whiteboards";
import type { WhiteboardListFilters } from "@/types/whiteboard";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/** How often the workspace list refetches while the tab is visible. */
export const WORKSPACE_WHITEBOARDS_REFETCH_MS = 30_000;

/**
 * Boards of every project the caller can see (live or archived), optionally
 * searched. Workspace screens have no project socket, so the list refetches
 * every 30 s while visible and on focus, like the other workspace lists;
 * changes made in this tab refresh it through mutation invalidation.
 */
export function useWorkspaceWhiteboards(
  workspaceId: string,
  filters: WhiteboardListFilters,
  options?: { enabled?: boolean },
) {
  const normalized = { archived: filters.archived, q: filters.q.trim() };
  return useQuery({
    queryKey: whiteboardQueryKeys.workspaceList(workspaceId, normalized),
    queryFn: () => listWorkspaceWhiteboards(workspaceId, normalized),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    // Typing a search keeps the last results of the same tab on screen.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === workspaceId &&
      (previousQuery.queryKey[3] as WhiteboardListFilters | undefined)
        ?.archived === normalized.archived
        ? previous
        : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: WORKSPACE_WHITEBOARDS_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}
