import { useTranslation } from "react-i18next";
import BurnChart from "@/components/charts/burn-chart";
import {
  type ChartUnit,
  estimateBurnChartProps,
} from "@/components/estimate/estimate-chart";
import ChartHint from "@/components/planning/chart-hint";
import { Skeleton } from "@/components/ui/skeleton";
import type { BurnChartMode } from "@/lib/charts/burn-chart-model";
import { daysBetween, formatCycleDate } from "@/lib/cycle/dates";
import type { Cycle, CycleProgress } from "@/types/cycle";

type CycleChartProps = {
  cycle: Pick<Cycle, "status" | "startDate" | "endDate" | "today">;
  progress: CycleProgress | undefined;
  isLoading?: boolean;
  mode: BurnChartMode;
  /** "estimate" sums estimate values when the report has that chart. */
  unit?: ChartUnit;
  height?: number;
};

/** The cycle's burn-down or burn-up, or the hint that explains its absence. */
export default function CycleChart({
  cycle,
  progress,
  isLoading,
  mode,
  unit = "tasks",
  height = 200,
}: CycleChartProps) {
  const { t } = useTranslation();

  if (!cycle.startDate || !cycle.endDate) {
    return <ChartHint height={height}>{t("cycles:chart.noDates")}</ChartHint>;
  }
  if (cycle.status === "upcoming") {
    return (
      <ChartHint height={height}>
        {t("cycles:chart.startsOn", { date: formatCycleDate(cycle.startDate) })}
      </ChartHint>
    );
  }
  if (isLoading || !progress) {
    return <Skeleton className="w-full rounded-lg" style={{ height }} />;
  }
  if (!progress.chart) {
    return <ChartHint height={height}>{t("cycles:chart.noTasks")}</ChartHint>;
  }

  const daysLeft = Math.max(0, daysBetween(progress.today, cycle.endDate));
  const estimateChart =
    unit === "estimate"
      ? estimateBurnChartProps({
          progress,
          mode,
          daysLeft,
          labels: {
            ideal: t("cycles:chart.ideal"),
            completed: t("cycles:chart.completed"),
            scope: t("cycles:chart.scope"),
          },
          t,
        })
      : null;
  if (estimateChart) {
    return (
      <BurnChart
        {...estimateChart}
        mode={mode}
        today={progress.today}
        height={height}
      />
    );
  }

  return (
    <BurnChart
      days={progress.chart.days}
      scope={progress.chart.scope}
      mode={mode}
      today={progress.today}
      height={height}
      ariaLabel={t("cycles:chart.summary", {
        pending: progress.pending,
        total: progress.chart.scope,
        days: daysLeft,
      })}
      labels={
        mode === "burndown"
          ? {
              actual: t("cycles:chart.pending"),
              reference: t("cycles:chart.ideal"),
            }
          : {
              actual: t("cycles:chart.completed"),
              reference: t("cycles:chart.scope"),
            }
      }
    />
  );
}
