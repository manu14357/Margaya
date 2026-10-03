import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTaskVotes } from "@/hooks/queries/publication/use-publication";

/**
 * "▲ 12 · ▼ 2" under the task's reactions while the project's board has
 * votes on; hidden when nobody voted. Read-only: members vote on the board.
 */
export default function TaskVoteSummary({
  taskId,
  votesEnabled,
}: {
  taskId: string | undefined;
  votesEnabled: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useTaskVotes(taskId, votesEnabled);
  if (!votesEnabled || !data?.enabled || data.up + data.down === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex w-fit cursor-default text-xs tabular-nums text-muted-foreground" />
          }
        >
          <span aria-hidden="true">
            {t("activity:votes.summary", { up: data.up, down: data.down })}
          </span>
          <span className="sr-only">
            {t("activity:votes.label", { up: data.up, down: data.down })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{t("activity:votes.tooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
