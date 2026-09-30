import type { QueryClient } from "@tanstack/react-query";
import { favoritesQueryKey } from "@/hooks/queries/favorite/use-get-favorites";
import { viewQueryKeys } from "@/hooks/queries/view/view-query-keys";

/** View lists, open views, favorites and recents follow a view change. */
export function invalidateViewQueries(
  queryClient: QueryClient,
  workspaceId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: viewQueryKeys.workspace(workspaceId),
  });
  void queryClient.invalidateQueries({
    queryKey: favoritesQueryKey(workspaceId),
  });
  void queryClient.invalidateQueries({
    queryKey: ["recent-visits", workspaceId],
  });
}
