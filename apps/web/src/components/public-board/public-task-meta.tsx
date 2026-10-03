import {
  ArrowBigUp,
  Calendar,
  CalendarClock,
  CalendarX,
  MessageSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { formatDateShort } from "@/lib/format";
import { getReaction } from "@/lib/reactions";
import type { PublicBoard, PublicTaskRow } from "@/types/public-board";

// Shared bits of the public card and row: labels and assignees in the
// shapes the existing components take, the due date and the count chips.

/** Labels for PublicTaskLabels (it keys by id; names are unique per task). */
export function rowLabels(row: Pick<PublicTaskRow, "labels">) {
  return row.labels.map((label) => ({ ...label, id: label.name }));
}

/** Assignees for AssigneeAvatarStack; the public payload has no ids. */
export function rowAssignees(row: Pick<PublicTaskRow, "assignees">) {
  return (row.assignees ?? []).map((person, index) => ({
    id: `${index}:${person.name}`,
    name: person.name,
    image: person.image,
  }));
}

export function PublicDueDate({
  dueDate,
  isCompleted,
}: {
  dueDate: string | null;
  isCompleted: boolean;
}) {
  if (!dueDate) return null;
  const status = getDueDateStatus(dueDate, isCompleted);
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[10px]",
        dueDateStatusColors[status],
      )}
    >
      {status === "overdue" ? (
        <CalendarX className="size-3" />
      ) : status === "due-soon" ? (
        <CalendarClock className="size-3" />
      ) : (
        <Calendar className="size-3" />
      )}
      <span>{formatDateShort(dueDate)}</span>
    </span>
  );
}

type PublicTaskChipsProps = {
  row: Pick<PublicTaskRow, "counts">;
  board: PublicBoard["board"];
  className?: string;
};

/**
 * Votes (always, while votes are on), the top three reactions and the
 * public comment count, each only for features that are on.
 */
export function PublicTaskChips({
  row,
  board,
  className,
}: PublicTaskChipsProps) {
  const { t } = useTranslation();
  const { counts } = row;
  const reactions = board.reactions
    ? (counts.reactions ?? []).filter((entry) => entry.count > 0).slice(0, 3)
    : [];
  const comments = board.comments ? (counts.comments ?? 0) : 0;
  const showVotes = board.votes && counts.votesUp !== undefined;
  if (!showVotes && reactions.length === 0 && comments === 0) return null;

  const chip =
    "inline-flex h-5 items-center gap-1 rounded-full border border-border bg-sidebar px-1.5 text-[10px] tabular-nums text-muted-foreground";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {showVotes && (
        <Tooltip>
          <TooltipTrigger render={<span className={chip} />}>
            <ArrowBigUp className="size-3" aria-hidden="true" />
            <span>{counts.votesUp ?? 0}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              {t("publicProject:card.votesTooltip", {
                up: counts.votesUp ?? 0,
                down: counts.votesDown ?? 0,
              })}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
      {reactions.map((entry) => {
        const reaction = getReaction(entry.emoji);
        if (!reaction) return null;
        return (
          <span
            key={entry.emoji}
            className={chip}
            title={t("publicProject:reactions.count", { count: entry.count })}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span>{entry.count}</span>
          </span>
        );
      })}
      {comments > 0 && (
        <span
          className={chip}
          title={t("publicProject:card.comments", { count: comments })}
        >
          <MessageSquare className="size-3" aria-hidden="true" />
          <span aria-hidden="true">{comments}</span>
          <span className="sr-only">
            {t("publicProject:card.comments", { count: comments })}
          </span>
        </span>
      )}
    </div>
  );
}
