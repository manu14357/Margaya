import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import useToggleReaction from "@/hooks/mutations/reaction/use-toggle-reaction";
import { cn } from "@/lib/cn";
import type { ReactionGroup } from "@/types/reaction";
import ReactionChip from "./reaction-chip";
import ReactionPicker from "./reaction-picker";

type ReactionBarProps = {
  taskId: string;
  /** Left out for the task's own bar. */
  commentId?: string;
  groups: readonly ReactionGroup[];
  /** Render the add button even when nobody reacted yet. */
  showAddButton?: boolean;
  className?: string;
};

/** A wrapping row of reaction chips, then the add-reaction button. */
export default function ReactionBar({
  taskId,
  commentId,
  groups,
  showAddButton = false,
  className,
}: ReactionBarProps) {
  const { user } = useAuth();
  const { toggle } = useToggleReaction(taskId);
  const visible = groups.filter((group) => group.count > 0);

  if (visible.length === 0 && !showAddButton) return null;

  return (
    <TooltipProvider>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        {visible.map((group) => (
          <ReactionChip
            key={group.emoji}
            group={group}
            meId={user?.id}
            onToggle={() =>
              toggle({ commentId, emoji: group.emoji, reacted: group.reacted })
            }
          />
        ))}
        <ReactionPicker
          groups={visible}
          onPick={(emoji, reacted) => toggle({ commentId, emoji, reacted })}
        />
      </div>
    </TooltipProvider>
  );
}
