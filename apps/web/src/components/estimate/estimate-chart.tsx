import { useTranslation } from "react-i18next";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import type {
  BurnChartDay,
  BurnChartMode,
} from "@/lib/charts/burn-chart-model";
import { formatEstimateValue, type Translate } from "@/lib/estimate/format";
import type { EstimateTotals } from "@/types/estimate";

// The points (or time) variant of the cycle and module burn charts. Progress
// reports carry `estimateChart` beside the task-count chart whenever a numeric
// system is active and some task in scope is estimated.

export type ChartUnit = "tasks" | "estimate";

export function isChartUnit(value: unknown): value is ChartUnit {
  return value === "tasks" || value === "estimate";
}

/** The burn charts' unit, one choice remembered for cycles and modules. */
export function useStoredChartUnit() {
  return useStoredState<ChartUnit>(
    "margaya:estimate-chart-unit",
    "tasks",
    isChartUnit,
  );
}

type ChartData = { scope: number; days: readonly BurnChartDay[] };

type ProgressWithEstimates = {
  estimates?: EstimateTotals | null;
  estimateChart?: ChartData | null;
};

/** The estimate chart and its unit, when the report has one to show. */
export function estimateChartOf(
  progress: ProgressWithEstimates | null | undefined,
): { chart: ChartData; type: "points" | "time" } | null {
  const estimates = progress?.estimates;
  const chart = progress?.estimateChart;
  if (!chart || !estimates?.enabled || !estimates.isNumeric) return null;
  if (estimates.type !== "points" && estimates.type !== "time") return null;
  return { chart, type: estimates.type };
}

/** The remaining amount on the last day that has one (today, or the end). */
function latestRemaining(chart: ChartData): number {
  for (let index = chart.days.length - 1; index >= 0; index--) {
    const remaining = chart.days[index]?.remaining;
    if (remaining !== null && remaining !== undefined) return remaining;
  }
  return chart.scope;
}

/**
 * BurnChart props for the estimate chart, or null to keep the task chart.
 * `labels` are the host's own words for the lines both charts share.
 */
export function estimateBurnChartProps({
  progress,
  mode,
  daysLeft,
  labels,
  t,
}: {
  progress: ProgressWithEstimates | null | undefined;
  mode: BurnChartMode;
  daysLeft: number;
  labels: { ideal: string; completed: string; scope: string };
  t: Translate;
}) {
  const source = estimateChartOf(progress);
  if (!source) return null;
  const { chart, type } = source;
  const formatValue = (value: number) =>
    formatEstimateValue(type, value, { t });

  return {
    days: chart.days,
    scope: chart.scope,
    formatValue,
    labels:
      mode === "burndown"
        ? {
            actual:
              type === "time"
                ? t("tasks:estimate.chart.timeLeft")
                : t("tasks:estimate.chart.pointsLeft"),
            reference: labels.ideal,
          }
        : { actual: labels.completed, reference: labels.scope },
    ariaLabel: t(
      type === "time"
        ? "tasks:estimate.chart.summaryTime"
        : "tasks:estimate.chart.summaryPoints",
      {
        remaining: formatValue(latestRemaining(chart)),
        scope: formatValue(chart.scope),
        days: daysLeft,
      },
    ),
  };
}

/** Switches a burn chart between counting tasks and summing estimates. */
export function EstimateChartUnitToggle({
  value,
  onChange,
  type,
}: {
  value: ChartUnit;
  onChange: (unit: ChartUnit) => void;
  type: "points" | "time";
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("tasks:estimate.chart.unitAria")}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0];
        if (isChartUnit(next)) onChange(next);
      }}
    >
      <Toggle value="tasks" className="px-2 text-xs">
        {t("tasks:estimate.chart.tasks")}
      </Toggle>
      <Toggle value="estimate" className="px-2 text-xs">
        {type === "time"
          ? t("tasks:estimate.chart.time")
          : t("tasks:estimate.chart.points")}
      </Toggle>
    </ToggleGroup>
  );
}
