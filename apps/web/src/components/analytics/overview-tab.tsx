import {
  Boxes,
  CircleCheck,
  FolderKanban,
  Inbox,
  IterationCw,
  ListTodo,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { useAnalyticsOverview } from "@/hooks/queries/analytics/use-analytics-overview";
import type { AnalyticsOverview } from "@/types/analytics";
import { useAnalyticsScope } from "./analytics-context";
import { SectionError } from "./analytics-section";
import GroupDonutCard from "./group-donut-card";
import { KpiRow, KpiTile } from "./kpi-tile";
import ProjectProgressCard from "./project-progress-card";
import WorkloadCard from "./workload-card";

function roleCount(overview: AnalyticsOverview, roles: readonly string[]) {
  return overview.members.byRole
    .filter((entry) => roles.includes(entry.role))
    .reduce((sum, entry) => sum + entry.count, 0);
}

function OverviewTiles({
  overview,
  isLoading,
}: {
  overview: AnalyticsOverview | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  if (isLoading || !overview) {
    return (
      <KpiRow>
        {[Users, FolderKanban, ListTodo, CircleCheck].map((icon, index) => (
          <KpiTile
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            key={index}
            label=""
            value={null}
            icon={icon}
            isLoading
          />
        ))}
      </KpiRow>
    );
  }
  const { tasks } = overview;
  const open = tasks.backlog + tasks.unstarted + tasks.started;
  return (
    <KpiRow>
      <KpiTile
        icon={Users}
        label={t("analytics:kpi.members")}
        value={overview.members.total}
        detail={t("analytics:kpi.membersDetail", {
          admins: roleCount(overview, ["owner", "admin"]),
          viewers: roleCount(overview, ["viewer"]),
        })}
      />
      <KpiTile
        icon={FolderKanban}
        label={t("analytics:kpi.projects")}
        value={overview.projects.total}
      />
      <KpiTile
        icon={ListTodo}
        label={t("analytics:kpi.openTasks")}
        value={open}
        detail={t("analytics:kpi.overdue", { count: tasks.overdue })}
      />
      <KpiTile
        icon={CircleCheck}
        label={t("analytics:kpi.completedTasks")}
        value={tasks.completed}
        detail={t("analytics:kpi.percentComplete", {
          percent: tasks.progress,
        })}
      />
      {overview.cycles && (
        <KpiTile
          icon={IterationCw}
          label={t("analytics:kpi.cyclesRunning")}
          value={overview.cycles.current}
          detail={t("analytics:kpi.upcoming", {
            count: overview.cycles.upcoming,
          })}
        />
      )}
      {overview.modules && (
        <KpiTile
          icon={Boxes}
          label={t("analytics:kpi.modulesInProgress")}
          value={overview.modules.byStatus["in-progress"] ?? 0}
          detail={t("analytics:kpi.modulesTotal", {
            count: overview.modules.total,
          })}
        />
      )}
      {overview.intake && (
        <KpiTile
          icon={Inbox}
          label={t("analytics:kpi.openRequests")}
          value={overview.intake.open}
          detail={t("analytics:kpi.accepted", {
            count: overview.intake.accepted,
          })}
        />
      )}
    </KpiRow>
  );
}

/** Workspace scope's first tab: headline numbers, projects, groups, workload. */
export default function OverviewTab() {
  const scope = useAnalyticsScope();
  const query = useAnalyticsOverview({
    workspaceId: scope.workspaceId,
    projectIds: scope.projectIds,
  });
  const retry = () => void query.refetch();

  return (
    <div className="grid gap-3">
      {query.error ? (
        <Card className="p-4">
          <SectionError error={query.error} onRetry={retry} />
        </Card>
      ) : (
        <OverviewTiles overview={query.data} isLoading={query.isLoading} />
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <ProjectProgressCard
          workspaceId={scope.workspaceId}
          overview={query.data}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={retry}
          className="lg:col-span-3"
        />
        <GroupDonutCard
          overview={query.data}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={retry}
          className="lg:col-span-2"
        />
      </div>
      <WorkloadCard />
    </div>
  );
}
