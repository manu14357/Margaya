import { useTranslation } from "react-i18next";
import DonutChart from "@/components/charts/donut-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { GROUP_CHART_COLORS } from "@/lib/charts/series-colors";
import {
  COLUMN_GROUP_META,
  CREATABLE_COLUMN_GROUPS,
} from "@/lib/column-groups";
import type { AnalyticsOverview } from "@/types/analytics";
import AnalyticsSection from "./analytics-section";

type GroupDonutCardProps = {
  overview: AnalyticsOverview | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
};

/** The scope's visible tasks by group, with counts and shares. */
export default function GroupDonutCard({
  overview,
  isLoading,
  error,
  onRetry,
  className,
}: GroupDonutCardProps) {
  const { t } = useTranslation();
  const tasks = overview?.tasks;
  const slices = CREATABLE_COLUMN_GROUPS.map((group) => ({
    key: group,
    label: t(COLUMN_GROUP_META[group].labelKey),
    value: tasks?.[group] ?? 0,
    color: GROUP_CHART_COLORS[group],
  }));
  const total = tasks?.total ?? 0;

  return (
    <AnalyticsSection
      title={t("analytics:overview.tasksByGroup")}
      isLoading={isLoading}
      skeleton={<Skeleton className="mx-auto size-44 rounded-full" />}
      error={error}
      onRetry={onRetry}
      className={className}
    >
      <DonutChart
        slices={slices}
        centerLabel={t("analytics:overview.donutCenter", { count: total })}
        emptyLabel={t("analytics:states.noTasks")}
        ariaLabel={t("analytics:a11y.donutSummary", {
          total,
          count: slices.filter((slice) => slice.value > 0).length,
        })}
      />
    </AnalyticsSection>
  );
}
