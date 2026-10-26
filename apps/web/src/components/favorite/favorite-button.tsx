import { Star, StarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  FavoriteEntityType,
  ToggleFavoriteVariables,
} from "@/hooks/mutations/favorite/use-toggle-favorite";
import { useFavoriteToggle } from "@/hooks/use-favorite-toggle";
import { cn } from "@/lib/cn";

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
  const {
    isFavorite,
    label,
    toggle: handleToggle,
  } = useFavoriteToggle({
    workspaceId,
    entityType,
    entityId,
    placeholder,
  });

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
