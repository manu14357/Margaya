import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import CircularProgress from "@/components/ui/circular-progress";
import { cn } from "@/lib/cn";
import { formatCycleRange } from "@/lib/cycle/dates";
import { getInitials } from "@/lib/get-initials";
import type { Cycle } from "@/types/cycle";
import CycleRowActions from "./cycle-row-actions";
import { CycleStatusBadge, CycleStatusIcon } from "./cycle-status";

type CycleRowProps = {
  cycle: Cycle;
  workspaceId: string;
  className?: string;
};

/** One cycle in the list; the whole row opens the cycle. */
export default function CycleRow({
  cycle,
  workspaceId,
  className,
}: CycleRowProps) {
  const { t } = useTranslation();
  const range = formatCycleRange(cycle.startDate, cycle.endDate);
  const scope = cycle.counts.total - cycle.counts.cancelled;

  return (
    <div
      className={cn(
        "group relative flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 transition-colors hover:bg-accent/40 md:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
        <CycleStatusIcon cycle={cycle} />
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId"
          params={{
            workspaceId,
            projectId: cycle.projectId,
            cycleId: cycle.id,
          }}
          className="min-w-0 truncate font-medium text-sm outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {cycle.name}
        </Link>
        {range && (
          <span className="hidden shrink-0 text-muted-foreground text-xs md:inline">
            {range}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <CycleStatusBadge cycle={cycle} />
        {cycle.owner ? (
          <Avatar
            className="size-5"
            title={t("cycles:row.owner", { name: cycle.owner.name })}
          >
            <AvatarImage src={cycle.owner.image ?? ""} alt={cycle.owner.name} />
            <AvatarFallback className="border border-border/30 font-medium text-[9px]">
              {getInitials(cycle.owner.name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span
            className="size-5 rounded-full border border-border border-dashed"
            title={t("cycles:row.noOwner")}
          />
        )}
        <span className="inline-flex items-center gap-1.5 text-xs">
          <CircularProgress completed={cycle.progress} total={100} />
          <span aria-hidden>{cycle.progress}%</span>
          <span className="sr-only">
            {t("cycles:row.progressLabel", { percent: cycle.progress })}
          </span>
        </span>
        <span className="hidden w-16 text-muted-foreground text-xs tabular-nums sm:inline">
          {t("cycles:row.doneOfTotal", {
            done: cycle.counts.completed,
            total: scope,
          })}
        </span>
        <CycleRowActions
          cycle={cycle}
          workspaceId={workspaceId}
          className="relative z-10"
        />
      </div>
    </div>
  );
}
