import { useTranslation } from "react-i18next";
import useToggleFavorite, {
  type FavoriteEntityType,
  type ToggleFavoriteVariables,
} from "@/hooks/mutations/favorite/use-toggle-favorite";
import useGetFavorites from "@/hooks/queries/favorite/use-get-favorites";
import { FAVORITES_LIMIT, findFavorite } from "@/lib/favorites";
import { toast } from "@/lib/toast";

type Options = {
  workspaceId: string;
  entityType: FavoriteEntityType;
  entityId: string;
  /** What the sidebar shows until the server answers. */
  placeholder?: ToggleFavoriteVariables["placeholder"];
};

/**
 * Whether the entity is a favorite, the matching "Add to" or "Remove from
 * favorites" label, and a toggle that keeps the limit and shows the toasts.
 * Shared by the star buttons and the command palette.
 */
export function useFavoriteToggle({
  workspaceId,
  entityType,
  entityId,
  placeholder,
}: Options) {
  const { t } = useTranslation();
  const { data: favorites } = useGetFavorites({ workspaceId });
  const { mutate: toggleFavorite } = useToggleFavorite();
  const isFavorite = Boolean(findFavorite(favorites, entityType, entityId));
  const label = isFavorite
    ? t("navigation:favorites.remove")
    : t("navigation:favorites.add");

  const toggle = () => {
    if (!workspaceId || !entityId) return;
    if (!isFavorite && (favorites?.length ?? 0) >= FAVORITES_LIMIT) {
      toast.error(
        t("navigation:favorites.limitReached", { count: FAVORITES_LIMIT }),
      );
      return;
    }

    toggleFavorite(
      { workspaceId, entityType, entityId, isFavorite, placeholder },
      {
        onSuccess: () => {
          toast.success(
            isFavorite
              ? t("navigation:favorites.removed")
              : t("navigation:favorites.added"),
          );
        },
        onError: () => {
          toast.error(t("navigation:favorites.error"));
        },
      },
    );
  };

  return { isFavorite, label, toggle };
}
