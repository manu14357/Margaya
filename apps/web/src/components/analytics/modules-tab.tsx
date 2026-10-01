import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import { Card } from "@/components/ui/card";
import { useAnalyticsModules } from "@/hooks/queries/analytics/use-analytics-modules";
import {
  entityTableModel,
  type TableColumn,
} from "@/lib/analytics/table-model";
import { cn } from "@/lib/cn";
import { modulePath } from "@/lib/module/entity-link";
import {
  isModuleStatus,
  MODULE_STATUS_META,
  MODULE_STATUS_ORDER,
} from "@/lib/module/status";
import type { AnalyticsModuleRow } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import AnalyticsDataTable, { useSortedTable } from "./analytics-data-table";
import AnalyticsSection, { SectionError } from "./analytics-section";
import { ProjectIcon, UserAvatar } from "./category-label";
import ExportCsvButton from "./export-csv-button";
import { KpiRow, KpiTile } from "./kpi-tile";

type Column = TableColumn & {
  value: (row: AnalyticsModuleRow) => string | number | null;
  alert?: (row: AnalyticsModuleRow) => boolean;
};

/** Module counts by status, overdue modules and the modules table. */
export default function ModulesTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scope = useAnalyticsScope();
  const query = useAnalyticsModules({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
  });
  const data = query.data;
  const retry = () => void query.refetch();
  const withProject = scope.kind === "workspace";
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const statusLabel = (status: string) =>
    isModuleStatus(status) ? t(MODULE_STATUS_META[status].labelKey) : status;
  const projectOf = (id: string) =>
    data?.meta.projects.find((project) => project.id === id);
  const userOf = (id: string | null) =>
    id ? data?.meta.users.find((user) => user.id === id) : undefined;

  const model = useMemo(() => {
    const projects = data?.meta.projects ?? [];
    const users = data?.meta.users ?? [];
    const columns: Column[] = [
      ...(withProject
        ? [
            {
              id: "project",
              label: t("analytics:dimensions.project"),
              kind: "text" as const,
              value: (row: AnalyticsModuleRow) =>
                projects.find((project) => project.id === row.projectId)
                  ?.name ?? null,
            },
          ]
        : []),
      {
        id: "name",
        label: t("analytics:modules.table.module"),
        kind: "text",
        value: (row) => row.name,
      },
      {
        id: "status",
        label: t("analytics:cycles.table.status"),
        kind: "text",
        value: (row) =>
          isModuleStatus(row.status)
            ? t(MODULE_STATUS_META[row.status].labelKey)
            : row.status,
      },
      {
        id: "lead",
        label: t("analytics:modules.table.lead"),
        kind: "text",
        value: (row) =>
          users.find((user) => user.id === row.leadId)?.name ?? null,
      },
      {
        id: "targetDate",
        label: t("analytics:modules.table.targetDate"),
        kind: "date",
        value: (row) => row.targetDate,
        alert: (row) => row.isOverdue,
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
        id: "pending",
        label: t("analytics:cycles.table.pending"),
        kind: "number",
        value: (row) => row.pending,
      },
    ];
    return entityTableModel(rows, columns);
  }, [rows, data?.meta, withProject, t]);
  const table = useSortedTable(model);

  return (
    <div className="grid gap-3">
      {query.error ? (
        <Card className="p-4">
          <SectionError error={query.error} onRetry={retry} />
        </Card>
      ) : (
        <KpiRow>
          {MODULE_STATUS_ORDER.map((status) => {
            const meta = MODULE_STATUS_META[status];
            return (
              <KpiTile
                key={status}
                icon={meta.icon}
                label={t(meta.labelKey)}
                value={data?.summary.byStatus[status] ?? 0}
                isLoading={query.isLoading}
              />
            );
          })}
          <KpiTile
            label={t("analytics:modules.overdue")}
            value={data?.summary.overdue ?? 0}
            isLoading={query.isLoading}
          />
        </KpiRow>
      )}
      <AnalyticsSection
        title={t("analytics:modules.table.title")}
        actions={<ExportCsvButton model={table.model} section="modules" />}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={retry}
        isEmpty={rows.length === 0}
        emptyTitle={t("analytics:states.noModules")}
      >
        {table.model && (
          <AnalyticsDataTable
            model={table.model}
            sort={table.sort}
            onSortChange={table.setSort}
            onRowClick={(row) => {
              const found = byId.get(row.key);
              if (found) {
                navigate({
                  to: modulePath(scope.workspaceId, found.projectId, found.id),
                });
              }
            }}
            renderCell={(column, row) => {
              const found = byId.get(row.key);
              if (!found) return undefined;
              if (column.id === "project") {
                const project = projectOf(found.projectId);
                return (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ProjectIcon icon={project?.icon} />
                    <span className="truncate">{project?.name}</span>
                  </span>
                );
              }
              if (column.id === "name") {
                return (
                  <span className="block truncate font-medium">
                    {found.name}
                  </span>
                );
              }
              if (column.id === "status" && isModuleStatus(found.status)) {
                const meta = MODULE_STATUS_META[found.status];
                const Icon = meta.icon;
                return (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon
                      aria-hidden
                      className={cn("size-3.5 shrink-0", meta.iconClassName)}
                    />
                    {statusLabel(found.status)}
                  </span>
                );
              }
              if (column.id === "lead") {
                const lead = userOf(found.leadId);
                return lead ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <UserAvatar name={lead.name} image={lead.image} />
                    <span className="truncate">{lead.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("analytics:modules.table.noLead")}
                  </span>
                );
              }
              if (column.id === "progress") {
                return (
                  <span className="inline-flex w-full min-w-24 items-center justify-end gap-2">
                    <GroupProgressBar counts={found.counts} className="w-16" />
                    <span className="tabular-nums">{found.progress}%</span>
                  </span>
                );
              }
              return undefined;
            }}
          />
        )}
      </AnalyticsSection>
    </div>
  );
}
