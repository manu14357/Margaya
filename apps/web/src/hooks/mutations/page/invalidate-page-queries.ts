import type { QueryClient } from "@tanstack/react-query";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";

type Options = {
  /** Lists to refresh (both projects after a move). */
  projectIds?: ReadonlyArray<string | null | undefined>;
  /** One page's detail, versions and backlinks; omitted refreshes none. */
  pageId?: string;
  /** Every open page (archive and access cascade to sub-pages). */
  allPages?: boolean;
  /** Favorites and recent visits show page titles, icons and access. */
  entities?: boolean;
};

/** Refreshes page queries after a change; only mounted queries refetch. */
export function invalidatePageQueries(
  queryClient: QueryClient,
  { projectIds = [], pageId, allPages, entities }: Options,
) {
  for (const projectId of new Set(projectIds)) {
    if (!projectId) continue;
    queryClient.invalidateQueries({ queryKey: pageQueryKeys.list(projectId) });
  }
  if (allPages) {
    queryClient.invalidateQueries({ queryKey: pageQueryKeys.all() });
  } else if (pageId) {
    queryClient.invalidateQueries({ queryKey: pageQueryKeys.detail(pageId) });
  }
  if (entities) {
    queryClient.invalidateQueries({ queryKey: ["favorites"] });
    queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
  }
}
