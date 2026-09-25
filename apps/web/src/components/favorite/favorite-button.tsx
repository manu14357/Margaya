import { Star, StarOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useToggleFavorite, {
  type FavoriteEntityType,
  type ToggleFavoriteVariables,
} from "@/hooks/mutations/favorite/use-toggle-favorite";
import useGetFavorites from "@/hooks/queries/favorite/use-get-favorites";
import { cn } from "@/lib/cn";
import { FAVORITES_LIMIT, findFavorite } from "@/lib/favorites";
import { toast } from "@/lib/toast";

type FavoriteButtonProps = {
  workspaceId: string;
  entityType: FavoriteEntityType;
  entityId: string;
  /** What the sidebar shows until the server answers. */
  placeholder?: ToggleFavoriteVariables["placeholder"];
  /** `menu-item` renders inside a DropdownMenu. */
  variant?: "button" | "menu-item";
  className?: string;
};

/** A star that adds the entity to, or removes it from, the user's favorites. */
export default function FavoriteButton({
  workspaceId,
  entityType,
  entityId,
  placeholder,
  variant = "button",
  className,
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { data: favorites } = useGetFavorites({ workspaceId });
  const { mutate: toggleFavorite } = useToggleFavorite();
  const isFavorite = Boolean(findFavorite(favorites, entityType, entityId));
  const label = isFavorite
    ? t("navigation:favorites.remove")
    : t("navigation:favorites.add");

  const handleToggle = () => {
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

  if (variant === "menu-item") {
    const Icon = isFavorite ? StarOff : Star;
    return (
      <DropdownMenuItem
        className={cn("h-7 items-start cursor-pointer text-sm", className)}
        onClick={handleToggle}
      >
        <Icon className="text-muted-foreground" />
        <span>{label}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={isFavorite}
            onClick={handleToggle}
            className={cn("text-muted-foreground", className)}
          >
            <Star
              className={cn(
                "size-3.5",
                isFavorite && "fill-current text-warning-foreground",
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
