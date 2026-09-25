import { useMutation, useQueryClient } from "@tanstack/react-query";
import createFavorite, {
  type CreateFavoriteRequest,
} from "@/fetchers/favorite/create-favorite";
import deleteFavoriteByEntity from "@/fetchers/favorite/delete-favorite-by-entity";
import {
  type Favorite,
  favoritesQueryKey,
} from "@/hooks/queries/favorite/use-get-favorites";
import {
  prependFavorite,
  removeFavoriteByEntity,
  replaceFavorite,
} from "@/lib/favorites";

export type FavoriteEntityType = CreateFavoriteRequest["entityType"];

export type ToggleFavoriteVariables = {
  workspaceId: string;
  entityType: FavoriteEntityType;
  entityId: string;
  /** Whether the entity is a favorite now; the toggle flips it. */
  isFavorite: boolean;
  /** Shown in the sidebar until the server row arrives. */
  placeholder?: Partial<Favorite["entity"]> & { name: string };
};

type Context = { previous?: Favorite[] };

function placeholderFavorite({
  workspaceId,
  entityType,
  entityId,
  placeholder,
}: ToggleFavoriteVariables): Favorite {
  const projectId =
    placeholder?.projectId ?? (entityType === "project" ? entityId : null);
  return {
    id: `optimistic:${entityType}:${entityId}`,
    workspaceId,
    projectId,
    entityType,
    entityId,
    position: 0,
    createdAt: new Date().toISOString(),
    entity: {
      type: entityType,
      id: entityId,
      name: placeholder?.name ?? "",
      key: placeholder?.key ?? null,
      icon: placeholder?.icon ?? null,
      projectId,
      projectName: placeholder?.projectName ?? null,
      isArchived: false,
      feature: placeholder?.feature ?? null,
      details: null,
    },
  };
}

export function isOptimisticFavorite(favorite: Pick<Favorite, "id">) {
  return favorite.id.startsWith("optimistic:");
}

/** Optimistic add or remove; the caller shows the toasts. */
function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation<Favorite | null, Error, ToggleFavoriteVariables, Context>({
    mutationFn: async ({ workspaceId, entityType, entityId, isFavorite }) => {
      if (isFavorite) {
        await deleteFavoriteByEntity({ workspaceId, entityType, entityId });
        return null;
      }
      return createFavorite({ workspaceId, entityType, entityId });
    },
    onMutate: async (variables) => {
      const queryKey = favoritesQueryKey(variables.workspaceId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Favorite[]>(queryKey);

      queryClient.setQueryData<Favorite[]>(queryKey, (current = []) =>
        variables.isFavorite
          ? removeFavoriteByEntity(
              current,
              variables.entityType,
              variables.entityId,
            )
          : prependFavorite(current, placeholderFavorite(variables)),
      );

      return { previous };
    },
    onSuccess: (saved, { workspaceId }) => {
      if (!saved) return;
      queryClient.setQueryData<Favorite[]>(
        favoritesQueryKey(workspaceId),
        (current = []) => replaceFavorite(current, saved),
      );
    },
    onError: (_error, { workspaceId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          favoritesQueryKey(workspaceId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: favoritesQueryKey(workspaceId),
      });
    },
  });
}

export default useToggleFavorite;
