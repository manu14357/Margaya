import { useTranslation } from "react-i18next";
import ReactionPicker from "@/components/reaction/reaction-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { getReaction } from "@/lib/reactions";
import type { PublicReactionGroup } from "@/types/public-board";

type PublicReactionBarProps = {
  groups: readonly PublicReactionGroup[];
  /** Hides the add button and makes the chips read-only. */
  canReact: boolean;
  onToggle: (emoji: PublicReactionGroup["emoji"], reacted: boolean) => void;
  className?: string;
};

/**
 * The public board's reactions: counts only (no names), my reactions
 * highlighted, and the add button for people allowed to react.
 */
export default function PublicReactionBar({
  groups,
  canReact,
  onToggle,
  className,
}: PublicReactionBarProps) {
  const { t } = useTranslation();
  const visible = groups.filter((group) => group.count > 0);
  if (visible.length === 0 && !canReact) return null;

  return (
    <TooltipProvider>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {visible.map((group) => {
          const reaction = getReaction(group.emoji);
          if (!reaction) return null;
          const label = t(reaction.labelKey);
          return (
            <Tooltip key={group.emoji}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    disabled={!canReact}
                    aria-pressed={group.reacted}
                    aria-label={
                      group.reacted
                        ? t("activity:reactions.remove", { label })
                        : t("activity:reactions.reactWith", { label })
                    }
                    onClick={() => onToggle(group.emoji, group.reacted)}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      group.reacted
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground enabled:hover:bg-accent",
                    )}
                  />
                }
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span>{group.count}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {t("publicProject:reactions.count", { count: group.count })}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {canReact && (
          <ReactionPicker
            groups={visible.map((group) => ({ ...group, users: [] }))}
            onPick={(emoji, reacted) => onToggle(emoji, reacted)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
