import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsChart } from "@/hooks/queries/analytics/use-analytics-chart";
import {
  DIMENSIONS,
  type DimensionAvailability,
  isDimensionAvailable,
} from "@/lib/analytics/dimensions";
import {
  breakdownTableModel,
  segmentColumnId,
  TOTAL_ROW_ID,
} from "@/lib/analytics/table-model";
import type {
  AnalyticsChartRequest,
  AnalyticsDimension,
  AnalyticsTaskSet,
} from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection from "./analytics-section";
import CategoryLabel from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { useLabelOf } from "./use-label-of";

const BREAKDOWN_DIMENSIONS = [
  "project",
  "assignee",
  "label",
  "priority",
  "cycle",
  "module",
  "createdBy",
] as const satisfies readonly AnalyticsDimension[];

export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** "Group rows by" choices of a scope; Project only with several projects. */
export function breakdownOptions(
  availability: DimensionAvailability,
): BreakdownDimension[] {
  return BREAKDOWN_DIMENSIONS.filter((dimension) =>
    isDimensionAvailable(dimension, availability),
  );
}

/** Project in a workspace with several projects, else Assignee. */
export function defaultBreakdown(
  kind: "workspace" | "project",
  options: readonly BreakdownDimension[],
): BreakdownDimension {
  return kind === "workspace" && options.includes("project")
    ? "project"
    : "assignee";
}

type BreakdownCardProps = {
  base: AnalyticsTaskSet;
  availability: DimensionAvailability;
};

/** Rows by a dimension, one column per group, with progress (B8 §1.4). */
export default function BreakdownCard({
  base,
  availability,
}: BreakdownCardProps) {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const labelId = useId();
  const options = breakdownOptions(availability);
  const [chosen, setChosen] = useState<BreakdownDimension | null>(null);
  const dimension =
    chosen && options.includes(chosen)
      ? chosen
      : defaultBreakdown(scope.kind, options);

  const request = useMemo<AnalyticsChartRequest>(
    () => ({
      ...base,
      xAxis: dimension,
      segment: "group",
      metric: "taskCount",
      includeNone: true,
    }),
    [base, dimension],
  );
  const query = useAnalyticsChart(request);
  const result = query.data;
  const labelOf = useLabelOf(result);
  const tableModel = useMemo(
    () =>
      result
        ? breakdownTableModel(result, {
            t,
            dimensionLabel: t(DIMENSIONS[result.xAxis].labelKey),
            labelOf,
          })
        : null,
    [result, t, labelOf],
  );
  const table = useSortedTable(tableModel);

  return (
    <AnalyticsSection
      title={t("analytics:breakdown.title")}
      actions={
        <>
          <div className="flex items-center gap-1.5">
            <span id={labelId} className="text-muted-foreground text-xs">
              {t("analytics:breakdown.groupRowsBy")}
            </span>
            <Select
              value={dimension}
              onValueChange={(value) => {
                const next = options.find((option) => option === value);
                if (next) setChosen(next);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-36 min-w-0"
                aria-labelledby={labelId}
              >
                <SelectValue>{t(DIMENSIONS[dimension].labelKey)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(DIMENSIONS[option].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ExportCsvButton
            model={table.model}
            section={`breakdown-${dimension}`}
          />
        </>
      }
      isLoading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!result || result.totalCount === 0}
      emptyTitle={t("analytics:states.noTasks")}
      isRefreshing={query.isPlaceholderData}
    >
      {result && table.model && (
        <AnalyticsDataTable
          model={table.model}
          sort={table.sort}
          onSortChange={table.setSort}
          renderCell={(column, row) => {
            if (row.id === TOTAL_ROW_ID) return undefined;
            if (column.id === "name") {
              return (
                <CategoryLabel
                  dimension={result.xAxis}
                  bucketKey={row.key}
                  name={labelOf(result.xAxis, row.key)}
                  meta={result.meta}
                />
              );
            }
            if (column.id === "progress") {
              const cell = (group: string) =>
                Number(row.cells[segmentColumnId(group)] ?? 0);
              const counts = {
                total: Number(row.cells.value ?? 0),
                backlog: cell("backlog"),
                unstarted: cell("unstarted"),
                started: cell("started"),
                completed: cell("completed"),
                cancelled: cell("cancelled"),
              };
              return (
                <span className="inline-flex w-full min-w-24 items-center justify-end gap-2">
                  <GroupProgressBar counts={counts} className="w-16" />
                  <span className="tabular-nums">
                    {row.cells.progress ?? 0}%
                  </span>
                </span>
              );
            }
            return undefined;
          }}
        />
      )}
    </AnalyticsSection>
  );
}
