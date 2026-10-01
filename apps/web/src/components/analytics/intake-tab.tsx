import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import LineChart from "@/components/charts/line-chart";
import { Card } from "@/components/ui/card";
import { useAnalyticsIntake } from "@/hooks/queries/analytics/use-analytics-intake";
import { formatBucketDay, periodTitle } from "@/lib/analytics/labels";
import {
  entityTableModel,
  seriesTableModel,
  type TableCell,
  type TableColumn,
} from "@/lib/analytics/table-model";
import {
  GROUP_CHART_COLORS,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import { browserTimeZone } from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { AnalyticsIntake } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, {
  SectionError,
  type SectionView,
  ViewToggle,
} from "./analytics-section";
import { ProjectIcon } from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { KpiRow, KpiTile } from "./kpi-tile";
import PeriodControls, { usePeriodState } from "./period-controls";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "5.5 h" under two days, "3 d" from 48 hours, "—" without decisions. */
export function formatTriageTime(hours: number | null, t: Translate): string {
  if (hours === null) return "—";
  if (hours >= 48) {
    return t("analytics:intake.days", { count: Math.round(hours / 2.4) / 10 });
  }
  return t("analytics:intake.hours", { count: Math.round(hours * 10) / 10 });
}

type IntakePoint = AnalyticsIntake["series"][number];
type IntakeProjectRow = NonNullable<AnalyticsIntake["byProject"]>[number];

const triagedOf = (point: IntakePoint) =>
  point.accepted + point.declined + point.duplicate;

/** Request counts, requests over time and (workspace scope) per project. */
export default function IntakeTab() {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const period = usePeriodState();
  const [view, setView] = useState<SectionView>("chart");
  const query = useAnalyticsIntake({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
    from: period.range.from,
    to: period.range.to,
    bucket: period.bucket,
    weekStartsOn,
    timeZone: browserTimeZone(),
  });
  const data = query.data;
  const retry = () => void query.refetch();

  const submittedLabel = t("analytics:intake.submitted");
  const triagedLabel = t("analytics:intake.triaged");
  const seriesModel = useMemo(
    () =>
      data
        ? seriesTableModel(
            data.series,
            [
              {
                id: "submitted",
                label: submittedLabel,
                value: (point) => point.submitted,
              },
              { id: "triaged", label: triagedLabel, value: triagedOf },
              {
                id: "accepted",
                label: t("analytics:intake.accepted"),
                value: (point) => point.accepted,
              },
              {
                id: "declined",
                label: t("analytics:intake.declined"),
                value: (point) => point.declined,
              },
              {
                id: "duplicate",
                label: t("analytics:intake.duplicate"),
                value: (point) => point.duplicate,
              },
            ],
            t,
          )
        : null,
    [data, submittedLabel, triagedLabel, t],
  );
  const seriesTable = useSortedTable(seriesModel);

  const projectModel = useMemo(() => {
    if (!data?.byProject) return null;
    const projects = data.meta.projects;
    const count =
      (key: "pending" | "snoozed" | "accepted" | "declined" | "duplicate") =>
      (row: IntakeProjectRow): TableCell =>
        row[key];
    const columns: Array<
      TableColumn & { value: (row: IntakeProjectRow) => TableCell }
    > = [
      {
        id: "project",
        label: t("analytics:dimensions.project"),
        kind: "text",
        value: (row) =>
          projects.find((project) => project.id === row.projectId)?.name ??
          null,
      },
      {
        id: "pending",
        label: t("analytics:intake.open"),
        kind: "number",
        value: count("pending"),
      },
      {
        id: "snoozed",
        label: t("analytics:intake.snoozed"),
        kind: "number",
        value: count("snoozed"),
      },
      {
        id: "accepted",
        label: t("analytics:intake.accepted"),
        kind: "number",
        value: count("accepted"),
      },
      {
        id: "declined",
        label: t("analytics:intake.declined"),
        kind: "number",
        value: count("declined"),
      },
      {
        id: "duplicate",
        label: t("analytics:intake.duplicate"),
        kind: "number",
        value: count("duplicate"),
      },
      {
        id: "median",
        label: t("analytics:intake.medianTriageHours"),
        kind: "number",
        value: (row) => row.medianHoursToTriage,
      },
    ];
    return entityTableModel(
      data.byProject.map((row) => ({ ...row, id: row.projectId })),
      columns,
    );
  }, [data, t]);
  const projectTable = useSortedTable(projectModel);

  const counts = data?.counts;
  const isEmptySeries =
    !data ||
    data.series.every(
      (point) => point.submitted === 0 && triagedOf(point) === 0,
    );

  return (
    <div className="grid gap-3">
      {query.error && !data ? (
        <Card className="p-4">
          <SectionError error={query.error} onRetry={retry} />
        </Card>
      ) : (
        <KpiRow className="xl:grid-cols-6">
          {(
            [
              ["open", counts?.pending],
              ["snoozed", counts?.snoozed],
              ["accepted", counts?.accepted],
              ["declined", counts?.declined],
              ["duplicate", counts?.duplicate],
            ] as const
          ).map(([key, value]) => (
            <KpiTile
              key={key}
              label={t(`analytics:intake.${key}`)}
              value={value ?? 0}
              isLoading={query.isLoading}
            />
          ))}
          <KpiTile
            label={t("analytics:intake.medianTriage")}
            value={formatTriageTime(data?.medianHoursToTriage ?? null, t)}
            isLoading={query.isLoading}
          />
        </KpiRow>
      )}

      <AnalyticsSection
        title={t("analytics:intake.chartTitle")}
        help={t("analytics:intake.chartHelp")}
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            {view === "table" && (
              <ExportCsvButton model={seriesTable.model} section="intake" />
            )}
          </>
        }
        controls={<PeriodControls state={period} />}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={retry}
        isEmpty={isEmptySeries}
        emptyTitle={t("analytics:states.noRequests")}
        isRefreshing={query.isPlaceholderData}
      >
        {data &&
          (view === "table" && seriesTable.model ? (
            <AnalyticsDataTable
              model={seriesTable.model}
              sort={seriesTable.sort}
              onSortChange={seriesTable.setSort}
            />
          ) : (
            <LineChart
              labels={data.series.map((point) =>
                formatBucketDay(point.start, data.bucket, {
                  today: data.today,
                }),
              )}
              series={[
                {
                  key: "submitted",
                  label: submittedLabel,
                  color: SINGLE_SERIES_COLOR,
                  values: data.series.map((point) => point.submitted),
                },
                {
                  key: "triaged",
                  label: triagedLabel,
                  color: GROUP_CHART_COLORS.completed,
                  values: data.series.map(triagedOf),
                },
              ]}
              tooltipTitle={(index) => {
                const point = data.series[index];
                return point ? periodTitle(point, data.bucket, { t }) : "";
              }}
              ariaLabel={t("analytics:a11y.lineSummary", {
                series: `${submittedLabel}, ${triagedLabel}`,
                count: data.series.length,
              })}
            />
          ))}
      </AnalyticsSection>

      {scope.kind === "workspace" && (
        <AnalyticsSection
          title={t("analytics:intake.byProject")}
          actions={
            <ExportCsvButton
              model={projectTable.model}
              section="intake-by-project"
            />
          }
          isLoading={query.isLoading}
          error={query.error}
          onRetry={retry}
          isEmpty={!projectTable.model || projectTable.model.rows.length === 0}
          emptyTitle={t("analytics:states.noRequests")}
        >
          {projectTable.model && (
            <AnalyticsDataTable
              model={projectTable.model}
              sort={projectTable.sort}
              onSortChange={projectTable.setSort}
              renderCell={(column, row) => {
                if (column.id === "project") {
                  const project = data?.meta.projects.find(
                    (entry) => entry.id === row.key,
                  );
                  return (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <ProjectIcon icon={project?.icon} />
                      <span className="truncate">{project?.name}</span>
                    </span>
                  );
                }
                if (column.id === "median") {
                  const value = row.cells.median;
                  return formatTriageTime(
                    typeof value === "number" ? value : null,
                    t,
                  );
                }
                return undefined;
              }}
            />
          )}
        </AnalyticsSection>
      )}
    </div>
  );
}
