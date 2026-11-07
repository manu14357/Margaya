import { Clock, ListChecks, Timer, Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAnalyticsScope } from "@/components/analytics/analytics-context";
import AnalyticsDataTable, {
  useSortedTable,
} from "@/components/analytics/analytics-data-table";
import AnalyticsSection, {
  SectionError,
} from "@/components/analytics/analytics-section";
import { ProjectIcon, UserAvatar } from "@/components/analytics/category-label";
import ExportCsvButton from "@/components/analytics/export-csv-button";
import { KpiRow, KpiTile } from "@/components/analytics/kpi-tile";
import PeriodControls, {
  usePeriodState,
} from "@/components/analytics/period-controls";
import { Card } from "@/components/ui/card";
import type { TimeReport } from "@/fetchers/time-entry/get-time-report";
import useGetRunningTimeEntry from "@/hooks/queries/time-entry/use-get-running-time-entry";
import useGetTimeReport from "@/hooks/queries/time-entry/use-get-time-report";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { entityTableModel } from "@/lib/analytics/table-model";
import { formatLoggedTime } from "@/lib/time-entry/format";
import RunningTimerBar from "./running-timer-bar";

type PersonRow = TimeReport["byPerson"][number] & { id: string };
type ProjectRow = TimeReport["byProject"][number] & { id: string };

/** Hours to two places: what a table sorts on and a CSV carries. */
export const hoursOf = (seconds: number) => Math.round(seconds / 36) / 100;

/** The analytics page's Time tab: totals by person and by project. */
export default function TimeReportTab() {
  const { t } = useTranslation();
  const scope = useAnalyticsScope();
  const period = usePeriodState();
  const { canUpdateTasks } = useWorkspacePermission();
  const query = useGetTimeReport({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
    from: period.range.from,
    to: period.range.to,
  });
  const { data: runningData } = useGetRunningTimeEntry(scope.workspaceId);
  const running = canUpdateTasks() ? (runningData?.entry ?? null) : null;
  const data = query.data;
  const retry = () => void query.refetch();

  const people = useMemo<PersonRow[]>(
    () =>
      (data?.byPerson ?? []).map((row) => ({
        ...row,
        id: row.userId ?? "former",
      })),
    [data],
  );
  const projects = useMemo<ProjectRow[]>(
    () => (data?.byProject ?? []).map((row) => ({ ...row, id: row.projectId })),
    [data],
  );
  const personName = (row: Pick<PersonRow, "name">) =>
    row.name ?? t("analytics:time.formerMember");

  const peopleModel = useMemo(
    () =>
      entityTableModel(people, [
        {
          id: "person",
          label: t("analytics:time.person"),
          kind: "text",
          value: (row) => row.name ?? t("analytics:time.formerMember"),
        },
        {
          id: "hours",
          label: t("analytics:time.hours"),
          kind: "number",
          value: (row) => hoursOf(row.seconds),
        },
        {
          id: "entries",
          label: t("analytics:time.entries"),
          kind: "number",
          value: (row) => row.entryCount,
        },
      ]),
    [people, t],
  );
  const projectsModel = useMemo(
    () =>
      entityTableModel(projects, [
        {
          id: "project",
          label: t("analytics:time.project"),
          kind: "text",
          value: (row) => row.name,
        },
        {
          id: "hours",
          label: t("analytics:time.hours"),
          kind: "number",
          value: (row) => hoursOf(row.seconds),
        },
        {
          id: "entries",
          label: t("analytics:time.entries"),
          kind: "number",
          value: (row) => row.entryCount,
        },
      ]),
    [projects, t],
  );
  const peopleTable = useSortedTable(peopleModel);
  const projectsTable = useSortedTable(projectsModel);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodControls state={period} showBucket={false} />
      </div>
      {running && (
        <RunningTimerBar
          timer={running}
          workspaceId={scope.workspaceId}
          className="bg-card"
        />
      )}
      {query.error ? (
        <Card className="p-4">
          <SectionError error={query.error} onRetry={retry} />
        </Card>
      ) : (
        <KpiRow>
          <KpiTile
            icon={Clock}
            label={t("analytics:time.total")}
            value={formatLoggedTime(data?.totalSeconds ?? 0, t)}
            isLoading={query.isLoading}
          />
          <KpiTile
            icon={ListChecks}
            label={t("analytics:time.entries")}
            value={data?.entryCount ?? 0}
            isLoading={query.isLoading}
          />
          <KpiTile
            icon={Users}
            label={t("analytics:time.people")}
            value={data?.byPerson.length ?? 0}
            isLoading={query.isLoading}
          />
          <KpiTile
            icon={Timer}
            label={t("analytics:time.running")}
            value={data?.runningCount ?? 0}
            detail={
              data?.runningCount ? t("analytics:time.runningNote") : undefined
            }
            isLoading={query.isLoading}
          />
        </KpiRow>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <AnalyticsSection
          title={t("analytics:time.byPerson")}
          actions={
            <ExportCsvButton model={peopleTable.model} section="time-people" />
          }
          isLoading={query.isLoading}
          error={query.error}
          onRetry={retry}
          isEmpty={people.length === 0}
          emptyTitle={t("analytics:time.empty")}
        >
          {peopleTable.model && (
            <AnalyticsDataTable
              model={peopleTable.model}
              sort={peopleTable.sort}
              onSortChange={peopleTable.setSort}
              renderCell={(column, row) => {
                const found = people.find((entry) => entry.id === row.key);
                if (!found) return undefined;
                if (column.id === "person") {
                  return (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <UserAvatar
                        name={personName(found)}
                        image={found.image}
                      />
                      <span className="truncate">{personName(found)}</span>
                    </span>
                  );
                }
                if (column.id === "hours") {
                  return formatLoggedTime(found.seconds, t);
                }
                return undefined;
              }}
            />
          )}
        </AnalyticsSection>
        <AnalyticsSection
          title={t("analytics:time.byProject")}
          actions={
            <ExportCsvButton
              model={projectsTable.model}
              section="time-projects"
            />
          }
          isLoading={query.isLoading}
          error={query.error}
          onRetry={retry}
          isEmpty={projects.length === 0}
          emptyTitle={t("analytics:time.empty")}
        >
          {projectsTable.model && (
            <AnalyticsDataTable
              model={projectsTable.model}
              sort={projectsTable.sort}
              onSortChange={projectsTable.setSort}
              renderCell={(column, row) => {
                const found = projects.find((entry) => entry.id === row.key);
                if (!found) return undefined;
                if (column.id === "project") {
                  return (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <ProjectIcon icon={found.icon} seed={found.projectId} />
                      <span className="truncate">{found.name}</span>
                    </span>
                  );
                }
                if (column.id === "hours") {
                  return formatLoggedTime(found.seconds, t);
                }
                return undefined;
              }}
            />
          )}
        </AnalyticsSection>
      </div>
    </div>
  );
}
