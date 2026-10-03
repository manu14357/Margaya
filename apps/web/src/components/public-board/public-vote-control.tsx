import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePublicBoardVote } from "@/hooks/mutations/public-board/use-public-board-vote";
import { usePublicBoardTask } from "@/hooks/queries/public-board/use-public-board-task";
import { cn } from "@/lib/cn";
import type { ParticipationState } from "@/lib/public-board/participation";

type PublicVoteControlProps = {
  token: string;
  number: number;
  participation: ParticipationState;
};

/**
 * Upvote and downvote with counts. Clicking my vote removes it; the other
 * button switches it. Visitors and guests see them disabled with a hint.
 */
export default function PublicVoteControl({
  token,
  number,
  participation,
}: PublicVoteControlProps) {
  const { t } = useTranslation();
  const { data: task } = usePublicBoardTask(token, number);
  const { vote, isPending } = usePublicBoardVote(token, number);
  const votes = task?.votes;
  if (!votes || participation.prompt === "hidden") return null;

  const canVote = participation.prompt === "allowed";
  const hint =
    participation.prompt === "blocked"
      ? t("publicProject:participation.blocked")
      : t("publicProject:votes.signInToVote");

  const buttons = (
    <div className="flex items-center gap-2">
      {([1, -1] as const).map((value) => {
        const isUp = value === 1;
        const count = isUp ? votes.up : votes.down;
        const pressed = votes.mine === value;
        const Icon = isUp ? ArrowBigUp : ArrowBigDown;
        return (
          <Button
            key={value}
            variant="outline"
            size="sm"
            aria-pressed={pressed}
            aria-label={
              isUp
                ? t("publicProject:votes.upvote", { count })
                : t("publicProject:votes.downvote", { count })
            }
            disabled={!canVote || isPending}
            onClick={() => vote(value)}
            className={cn(
              "gap-1.5 tabular-nums",
              pressed && "border-primary/40 bg-primary/10 text-foreground",
            )}
          >
            <Icon className={cn("size-4", pressed && "fill-current")} />
            {count}
          </Button>
        );
      })}
    </div>
  );

  return (
    <section
      aria-label={t("publicProject:votes.title")}
      className="flex items-center gap-2"
    >
      {canVote ? (
        buttons
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              {buttons}
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{hint}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {!canVote && <span className="sr-only">{hint}</span>}
    </section>
  );
}
