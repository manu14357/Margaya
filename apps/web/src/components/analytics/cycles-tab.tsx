import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { useAnalyticsCycles } from "@/hooks/queries/analytics/use-analytics-cycles";
import { formatNumber } from "@/lib/format";
import { useAnalyticsScope } from "./analytics-context";
import { SectionError } from "./analytics-section";
import CyclesTable from "./cycles-table";
import { KpiRow, KpiTile } from "./kpi-tile";
import VelocityCard from "./velocity-card";

/** Cycle counts, velocity (one project) and the cycles table. */
export default function CyclesTab() {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const query = useAnalyticsCycles({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
  });
  const data = query.data;
  const retry = () => void query.refetch();

  return (
    <div className="grid gap-3">
      {query.error ? (
        <Card className="p-4">
          <SectionError error={query.error} onRetry={retry} />
        </Card>
      ) : (
        <KpiRow className="xl:grid-cols-5">
          <KpiTile
            label={t("analytics:cycles.current")}
            value={data?.summary.current ?? 0}
            isLoading={query.isLoading}
          />
          <KpiTile
            label={t("analytics:cycles.upcoming")}
            value={data?.summary.upcoming ?? 0}
            isLoading={query.isLoading}
          />
          <KpiTile
            label={t("analytics:cycles.drafts")}
            value={data?.summary.draft ?? 0}
            isLoading={query.isLoading}
          />
          <KpiTile
            label={t("analytics:cycles.completedRecent")}
            value={data?.summary.completedRecent ?? 0}
            isLoading={query.isLoading}
          />
          {data?.velocity && (
            <KpiTile
              label={t("analytics:cycles.averageCompleted")}
              value={
                data.averageCompleted === null
                  ? "—"
                  : formatNumber(data.averageCompleted)
              }
            />
          )}
        </KpiRow>
      )}
      <VelocityCard
        data={data}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={retry}
      />
      <CyclesTable
        data={data}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={retry}
      />
    </div>
  );
}
