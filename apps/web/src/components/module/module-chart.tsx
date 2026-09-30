import { useTranslation } from "react-i18next";
import BurnChart from "@/components/charts/burn-chart";
import {
  type ChartUnit,
  estimateBurnChartProps,
} from "@/components/estimate/estimate-chart";
import ChartHint from "@/components/planning/chart-hint";
import { Skeleton } from "@/components/ui/skeleton";
import type { BurnChartMode } from "@/lib/charts/burn-chart-model";
import { daysBetween } from "@/lib/cycle/dates";
import { isChartRangeTooLong } from "@/lib/module/dates";
import type { Module, ModuleProgress } from "@/types/module";

type ModuleChartProps = {
  module: Pick<Module, "startDate" | "targetDate">;
  progress: ModuleProgress | undefined;
  isLoading?: boolean;
  mode: BurnChartMode;
  /** "estimate" sums estimate values when the report has that chart. */
  unit?: ChartUnit;
  height?: number;
};

/** The module's burndown or burnup, or the hint that explains its absence. */
export default function ModuleChart({
  module,
  progress,
  isLoading,
  mode,
  unit = "tasks",
  height = 200,
}: ModuleChartProps) {
  const { t } = useTranslation();
  const { startDate, targetDate } = module;

  if (!startDate || !targetDate) {
    return <ChartHint height={height}>{t("modules:chart.noDates")}</ChartHint>;
  }
  if (isChartRangeTooLong(startDate, targetDate)) {
    return <ChartHint height={height}>{t("modules:chart.tooLong")}</ChartHint>;
  }
  if (isLoading || !progress) {
    return <Skeleton className="w-full rounded-lg" style={{ height }} />;
  }
  if (!progress.chart) {
    return <ChartHint height={height}>{t("modules:chart.noTasks")}</ChartHint>;
  }

  const daysLeft = Math.max(0, daysBetween(progress.today, targetDate));
  const estimateChart =
    unit === "estimate"
      ? estimateBurnChartProps({
          progress,
          mode,
          daysLeft,
          labels: {
            ideal: t("modules:chart.ideal"),
            completed: t("modules:chart.completed"),
            scope: t("modules:chart.scope"),
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
      ariaLabel={t("modules:chart.ariaSummary", {
        pending: progress.pending,
        scope: progress.chart.scope,
        days: daysLeft,
      })}
      labels={
        mode === "burndown"
          ? {
              actual: t("modules:chart.pending"),
              reference: t("modules:chart.ideal"),
            }
          : {
              actual: t("modules:chart.completed"),
              reference: t("modules:chart.scope"),
            }
      }
    />
  );
}
