import { useInfiniteQuery } from "@tanstack/react-query";
import getStickies, {
  type Sticky,
  type StickyPage,
} from "@/fetchers/sticky/get-stickies";
import { stickiesQueryKey } from "@/lib/sticky-cache";

export type { Sticky, StickyPage };

export const STICKY_PAGE_SIZE = 30;
export const STICKY_WIDGET_SIZE = 6;

/**
 * The caller's stickies in display order, one page per fetch. The Home
 * widget reads only the first page; the Stickies page pages through all.
 */
function useGetStickies({
  workspaceId,
  q = "",
  limit = STICKY_PAGE_SIZE,
}: {
  workspaceId: string;
  q?: string;
  limit?: number;
}) {
  return useInfiniteQuery({
    queryKey: stickiesQueryKey(workspaceId, q, limit),
    queryFn: ({ pageParam }) =>
      getStickies({
        workspaceId,
        q: q || undefined,
        limit,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(workspaceId),
  });
}

export default useGetStickies;
