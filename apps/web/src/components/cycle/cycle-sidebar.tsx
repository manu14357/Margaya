import { CalendarDays, ListTodo, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import {
  EstimateChartUnitToggle,
  estimateChartOf,
  useStoredChartUnit,
} from "@/components/estimate/estimate-chart";
import EstimateProgressSummary from "@/components/estimate/estimate-progress-summary";
import ExpandableDescription from "@/components/planning/expandable-description";
import PlanningBreakdown, {
  type PlanningFilterControls,
} from "@/components/planning/planning-breakdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import useGetCycleProgress from "@/hooks/queries/cycle/use-get-cycle-progress";
import type { BurnChartMode } from "@/lib/charts/burn-chart-model";
import { formatCycleRange } from "@/lib/cycle/dates";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import type { Cycle } from "@/types/cycle";
import CycleChart from "./cycle-chart";
import { CycleStatusBadge } from "./cycle-status";

type CycleSidebarProps = PlanningFilterControls & {
  cycle: Cycle;
};

function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="w-16 shrink-0 text-muted-foreground text-xs">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

/**
 * Beside the cycle's board: its name, then progress and the burn chart
 * (what people check most), then dates, owner and the breakdowns.
 */
export default function CycleSidebar({ cycle, ...filters }: CycleSidebarProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BurnChartMode>("burndown");
  const { data: progress, isLoading } = useGetCycleProgress(
    cycle.projectId,
    cycle.id,
  );
  const [unit, setUnit] = useStoredChartUnit();
  const estimateChart = estimateChartOf(progress);
  const range = formatCycleRange(cycle.startDate, cycle.endDate);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <section className="space-y-2">
        <CycleStatusBadge cycle={cycle} />
        <h2 className="font-semibold text-base leading-snug">{cycle.name}</h2>
        <ExpandableDescription text={cycle.description} />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-muted-foreground text-xs">
            {t("cycles:sidebar.progress")}
          </h3>
          <span className="font-semibold text-lg tabular-nums">
            {cycle.progress}%
          </span>
        </div>
        <GroupProgressBar
          counts={cycle.counts}
          cancelledLabel={t("cycles:sidebar.cancelledCount", {
            count: cycle.counts.cancelled,
          })}
        />
        {progress?.isFrozen && progress.frozenAt && (
          <p className="text-muted-foreground text-xs">
            {t("cycles:sidebar.frozen", {
              date: formatDateMedium(progress.frozenAt),
            })}
          </p>
        )}
        <EstimateProgressSummary estimates={progress?.estimates} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            size="sm"
            variant="outline"
            value={[mode]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "burndown" || next === "burnup") setMode(next);
            }}
          >
            <Toggle value="burndown" className="px-2 text-xs">
              {t("cycles:sidebar.burndown")}
            </Toggle>
            <Toggle value="burnup" className="px-2 text-xs">
              {t("cycles:sidebar.burnup")}
            </Toggle>
          </ToggleGroup>
          {estimateChart && (
            <EstimateChartUnitToggle
              value={unit}
              onChange={setUnit}
              type={estimateChart.type}
            />
          )}
        </div>
        <CycleChart
          cycle={cycle}
          progress={progress}
          isLoading={isLoading}
          mode={mode}
          unit={estimateChart ? unit : "tasks"}
        />
      </section>

      <section className="space-y-2">
        <PropertyRow icon={CalendarDays} label={t("cycles:sidebar.dates")}>
          {range ?? (
            <span className="text-muted-foreground">
              {t("cycles:badge.noDates")}
            </span>
          )}
        </PropertyRow>
        <PropertyRow icon={UserRound} label={t("cycles:sidebar.owner")}>
          {cycle.owner ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar className="size-4">
                <AvatarImage
                  src={cycle.owner.image ?? ""}
                  alt={cycle.owner.name}
                />
                <AvatarFallback className="text-[8px]">
                  {getInitials(cycle.owner.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{cycle.owner.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("cycles:row.noOwner")}
            </span>
          )}
        </PropertyRow>
        <PropertyRow icon={ListTodo} label={t("cycles:sidebar.tasks")}>
          {t("cycles:detail.taskCount", { count: cycle.counts.total })}
        </PropertyRow>
      </section>

      <section>
        {progress ? (
          <PlanningBreakdown progress={progress} {...filters} />
        ) : isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : null}
      </section>
    </div>
  );
}
