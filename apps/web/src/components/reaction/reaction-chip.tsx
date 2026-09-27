import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatReactionUsers, getReaction } from "@/lib/reactions";
import type { ReactionGroup } from "@/types/reaction";

type ReactionChipProps = {
  group: ReactionGroup;
  meId: string | undefined;
  onToggle: () => void;
};

/** One emoji's pill: the count, my highlight, and who reacted on hover. */
export default function ReactionChip({
  group,
  meId,
  onToggle,
}: ReactionChipProps) {
  const { t } = useTranslation();
  const reaction = getReaction(group.emoji);
  if (!reaction || group.count <= 0) return null;

  const label = t(reaction.labelKey);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={group.reacted}
          aria-label={
            group.reacted
              ? t("activity:reactions.remove", { label })
              : t("activity:reactions.reactWith", { label })
          }
          onClick={onToggle}
          className={cn(
            "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            group.reacted
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent",
          )}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span>{group.count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{formatReactionUsers(group, meId, t)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
