import {
  type MutateOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import reorderFavorites from "@/fetchers/favorite/reorder-favorites";
import {
  type Favorite,
  favoritesQueryKey,
} from "@/hooks/queries/favorite/use-get-favorites";

type ReorderVariables = {
  workspaceId: string;
  favorites: Favorite[];
  previous?: Favorite[];
};

function useReorderFavorites() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ workspaceId, favorites }: ReorderVariables) =>
      reorderFavorites({
        workspaceId,
        favoriteIds: favorites.map((favorite) => favorite.id),
      }),
    onError: (_error, { workspaceId, previous }) => {
      if (previous) {
        queryClient.setQueryData(favoritesQueryKey(workspaceId), previous);
      }
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: favoritesQueryKey(workspaceId),
      });
    },
  });

  // Writes the cache before mutating, like the project reorder, so the drop
  // never paints the old order for a frame.
  return useCallback(
    (
      workspaceId: string,
      ordered: Favorite[],
      options?: MutateOptions<unknown, Error, ReorderVariables>,
    ) => {
      const queryKey = favoritesQueryKey(workspaceId);
      const previous = queryClient.getQueryData<Favorite[]>(queryKey);
      queryClient.setQueryData<Favorite[]>(queryKey, ordered);
      queryClient.cancelQueries({ queryKey });
      mutation.mutate({ workspaceId, favorites: ordered, previous }, options);
    },
    [queryClient, mutation],
  );
}

export default useReorderFavorites;
