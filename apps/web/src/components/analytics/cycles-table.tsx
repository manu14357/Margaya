import { useNavigate } from "@tanstack/react-router";
import { Snowflake } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CircularProgress from "@/components/ui/circular-progress";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import {
  type CycleFilter,
  filterCycleRows,
  isCycleFilter,
  loadCycleFilter,
  saveCycleFilter,
} from "@/lib/analytics/cycle-filter";
import {
  entityTableModel,
  type TableColumn,
} from "@/lib/analytics/table-model";
import { cn } from "@/lib/cn";
import { cyclePath } from "@/lib/cycle/entity-link";
import { CYCLE_STATUS_META } from "@/lib/cycle/status";
import type { AnalyticsCycleRow, AnalyticsCycles } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection from "./analytics-section";
import { ProjectIcon } from "./category-label";
import ExportCsvButton from "./export-csv-button";

type CyclesTableProps = {
  data: AnalyticsCycles | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
};

/** All cycles, or only the running ones across the scope's projects. */
export function CycleFilterToggle({
  value,
  onChange,
}: {
  value: CycleFilter;
  onChange: (filter: CycleFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("analytics:cycles.filter.label")}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0];
        if (isCycleFilter(next)) onChange(next);
      }}
    >
      <Toggle value="all" className="px-2 text-xs">
        {t("analytics:cycles.filter.all")}
      </Toggle>
      <Toggle value="running" className="px-2 text-xs">
        {t("analytics:cycles.filter.running")}
      </Toggle>
    </ToggleGroup>
  );
}

/** Current, upcoming, draft and recently completed cycles (B8 §1.7). */
export default function CyclesTable({
  data,
  isLoading,
  error,
  onRetry,
}: CyclesTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scope = useAnalyticsScope();
  const withProject = scope.kind === "workspace";
  const projectOf = (id: string) =>
    data?.meta.projects.find((project) => project.id === id);
  const [stored, setStored] = useState(() => ({
    scopeKey: scope.scopeKey,
    filter: loadCycleFilter(scope.scopeKey),
  }));
  const filter =
    stored.scopeKey === scope.scopeKey
      ? stored.filter
      : loadCycleFilter(scope.scopeKey);
  const changeFilter = (next: CycleFilter) => {
    setStored({ scopeKey: scope.scopeKey, filter: next });
    saveCycleFilter(scope.scopeKey, next);
  };
  const allRows = data?.rows;
  const rows = useMemo(
    () => filterCycleRows(allRows ?? [], filter),
    [allRows, filter],
  );
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const model = useMemo(() => {
    type Column = TableColumn & {
      value: (row: AnalyticsCycleRow) => string | number | null;
    };
    const projects = data?.meta.projects ?? [];
    const columns: Column[] = [
      ...(withProject
        ? [
            {
              id: "project",
              label: t("analytics:dimensions.project"),
              kind: "text" as const,
              value: (row: AnalyticsCycleRow) =>
                projects.find((project) => project.id === row.projectId)
                  ?.name ?? null,
            },
          ]
        : []),
      {
        id: "name",
        label: t("analytics:cycles.table.cycle"),
        kind: "text",
        value: (row) => row.name,
      },
      {
        id: "status",
        label: t("analytics:cycles.table.status"),
        kind: "text",
        value: (row) => t(CYCLE_STATUS_META[row.status].labelKey),
      },
      {
        id: "startDate",
        label: t("analytics:dimensions.startDate"),
        kind: "date",
        value: (row) => row.startDate,
      },
      {
        id: "endDate",
        label: t("analytics:cycles.table.endDate"),
        kind: "date",
        value: (row) => row.endDate,
      },
      {
        id: "progress",
        label: t("analytics:table.progress"),
        kind: "percent",
        value: (row) => row.progress,
      },
      {
        id: "completed",
        label: t("analytics:cycles.table.done"),
        kind: "number",
        value: (row) => row.counts.completed,
      },
      {
        id: "committed",
        label: t("analytics:cycles.table.committed"),
        kind: "number",
        value: (row) => row.committed,
      },
      {
        id: "cancelled",
        label: t("analytics:cycles.table.cancelled"),
        kind: "number",
        value: (row) => row.counts.cancelled,
      },
      {
        id: "pending",
        label: t("analytics:cycles.table.pending"),
        kind: "number",
        value: (row) => row.pending,
      },
    ];
    return entityTableModel(rows, columns);
  }, [rows, data?.meta.projects, withProject, t]);
  const table = useSortedTable(model);

  return (
    <AnalyticsSection
      title={t("analytics:cycles.table.title")}
      actions={
        <>
          <CycleFilterToggle value={filter} onChange={changeFilter} />
          <ExportCsvButton
            model={table.model}
            section={filter === "running" ? "running-cycles" : "cycles"}
          />
        </>
      }
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={rows.length === 0}
      emptyTitle={
        filter === "running" && (allRows?.length ?? 0) > 0
          ? t("analytics:states.noRunningCycles")
          : t("analytics:states.noCycles")
      }
    >
      {table.model && (
        <AnalyticsDataTable
          model={table.model}
          sort={table.sort}
          onSortChange={table.setSort}
          onRowClick={(row) => {
            const cycle = byId.get(row.key);
            if (cycle) {
              navigate({
                to: cyclePath(scope.workspaceId, cycle.projectId, cycle.id),
              });
            }
          }}
          renderCell={(column, row) => {
            const cycle = byId.get(row.key);
            if (!cycle) return undefined;
            if (column.id === "project") {
              const project = projectOf(cycle.projectId);
              return (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <ProjectIcon icon={project?.icon} />
                  <span className="truncate">{project?.name}</span>
                </span>
              );
            }
            if (column.id === "name") {
              return (
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  <span className="truncate">{cycle.name}</span>
                  {cycle.isFrozen && (
                    <span
                      title={t("analytics:cycles.table.frozen")}
                      className="inline-flex shrink-0 text-muted-foreground"
                    >
                      <Snowflake aria-hidden className="size-3" />
                      <span className="sr-only">
                        {t("analytics:cycles.table.frozen")}
                      </span>
                    </span>
                  )}
                </span>
              );
            }
            if (column.id === "status") {
              const meta = CYCLE_STATUS_META[cycle.status];
              const Icon = meta.icon;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Icon
                    aria-hidden
                    className={cn("size-3.5 shrink-0", meta.iconClassName)}
                  />
                  {t(meta.labelKey)}
                </span>
              );
            }
            if (column.id === "progress") {
              return (
                <span className="inline-flex items-center justify-end gap-1.5">
                  <CircularProgress completed={cycle.progress} total={100} />
                  {cycle.progress}%
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
