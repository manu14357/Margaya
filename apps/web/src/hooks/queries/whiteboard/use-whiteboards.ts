import { useQuery } from "@tanstack/react-query";
import { listWhiteboards } from "@/fetchers/whiteboard/whiteboards";
import type { WhiteboardListFilters } from "@/types/whiteboard";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/** A project's boards (active or archived), optionally searched. */
export function useWhiteboards(
  projectId: string,
  filters: WhiteboardListFilters,
  options?: { enabled?: boolean },
) {
  const normalized = { archived: filters.archived, q: filters.q.trim() };
  return useQuery({
    queryKey: whiteboardQueryKeys.list(projectId, normalized),
    queryFn: () => listWhiteboards(projectId, normalized),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
    // Typing a search keeps the tab's last results on screen until the next
    // load; switching between live and archived boards starts empty.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === projectId &&
      (previousQuery.queryKey[2] as WhiteboardListFilters | undefined)
        ?.archived === normalized.archived
        ? previous
        : undefined,
    staleTime: 30_000,
  });
}
