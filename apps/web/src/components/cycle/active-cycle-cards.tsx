import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import {
  BreakdownList,
  useAssigneeItems,
  useLabelItems,
} from "@/components/planning/breakdown-list";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Card, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import CircularProgress from "@/components/ui/circular-progress";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { COLUMN_GROUP_META } from "@/lib/column-groups";
import { highPriorityCycleTasks } from "@/lib/cycle/scope";
import { getPriorityIcon } from "@/lib/priority";
import type { Cycle, CycleProgress } from "@/types/cycle";
import type { ProjectWithTasks } from "@/types/project";
import CycleChart from "./cycle-chart";

const PROGRESS_GROUPS = [
  "started",
  "unstarted",
  "backlog",
  "completed",
] as const;

export function CycleProgressCard({ cycle }: { cycle: Cycle }) {
  const { t } = useTranslation();
  const scope = cycle.counts.total - cycle.counts.cancelled;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-medium text-muted-foreground text-sm">
          {t("cycles:active.progressTitle")}
        </CardTitle>
      </CardHeader>
      <CardPanel className="space-y-3">
        <div className="flex items-center gap-3">
          <CircularProgress
            completed={cycle.progress}
            total={100}
            size={44}
            strokeWidth={5}
          />
          <p className="font-semibold text-3xl text-primary tabular-nums">
            {cycle.progress}%
          </p>
        </div>
        <GroupProgressBar
          counts={cycle.counts}
          cancelledLabel={t("cycles:sidebar.cancelledCount", {
            count: cycle.counts.cancelled,
          })}
        />
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {PROGRESS_GROUPS.map((group) => {
            const meta = COLUMN_GROUP_META[group];
            const Icon = meta.icon;
            return (
              <li key={group} className="flex items-center gap-1.5">
                <Icon className={`size-3.5 ${meta.iconClassName}`} />
                <span className="text-muted-foreground">
                  {t(meta.labelKey)}
                </span>
                <span className="ml-auto tabular-nums">
                  {cycle.counts[group]}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-xs">
          {t("cycles:active.progressDone", {
            done: cycle.counts.completed,
            total: scope,
          })}
        </p>
      </CardPanel>
    </Card>
  );
}

export function CycleBurndownCard({
  cycle,
  progress,
  isLoading,
  workspaceId,
}: {
  cycle: Cycle;
  progress: CycleProgress | undefined;
  isLoading: boolean;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-medium text-muted-foreground text-sm">
          {t("cycles:active.burndownTitle")}
        </CardTitle>
      </CardHeader>
      <CardPanel className="space-y-3">
        <p className="font-medium text-sm">
          {t("cycles:active.pending", { count: cycle.pending })}
        </p>
        <CycleChart
          cycle={cycle}
          progress={progress}
          isLoading={isLoading}
          mode="burndown"
          height={160}
        />
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId"
          params={{
            workspaceId,
            projectId: cycle.projectId,
            cycleId: cycle.id,
          }}
          className="inline-flex items-center gap-1 font-medium text-primary text-xs hover:underline"
        >
          {t("cycles:active.openCycle")}
          <ArrowRight className="size-3" />
        </Link>
      </CardPanel>
    </Card>
  );
}

type StatsTab = "priority" | "assignees" | "labels";

const STATS_TABS: readonly StatsTab[] = ["priority", "assignees", "labels"];

function HighPriorityList({
  cycle,
  workspaceId,
}: {
  cycle: Cycle;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: board } = useGetTasks(cycle.projectId);
  const tasks = highPriorityCycleTasks(
    board as ProjectWithTasks | undefined,
    cycle.id,
  );
  if (tasks.length === 0) {
    return (
      <p className="px-2 py-3 text-muted-foreground text-xs">
        {t("cycles:active.noHighPriority")}
      </p>
    );
  }
  return (
    <ul className="space-y-0.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId",
                params: {
                  workspaceId,
                  projectId: cycle.projectId,
                  cycleId: cycle.id,
                },
                search: { taskId: task.id },
              })
            }
          >
            <span className="flex size-4 items-center justify-center">
              {getPriorityIcon(task.priority ?? "")}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground text-xs">
              {board?.slug}-{task.number}
            </span>
            <span className="truncate">{task.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CycleStatsCard({
  cycle,
  progress,
  workspaceId,
}: {
  cycle: Cycle;
  progress: CycleProgress | undefined;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useStoredState<StatsTab>(
    "margaya:cycle-stats-tab",
    "priority",
    (value) => STATS_TABS.includes(value as StatsTab),
  );
  const assignees = useAssigneeItems(progress?.assignees ?? []);
  const labels = useLabelItems(progress?.labels ?? []);

  return (
    <Card className="lg:col-span-2 xl:col-span-1">
      <CardPanel className="pt-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as StatsTab)}>
          <TabsList className="w-full">
            <TabsTab value="priority" className="text-xs">
              {t("cycles:active.statsHighPriority")}
            </TabsTab>
            <TabsTab value="assignees" className="text-xs">
              {t("cycles:active.statsAssignees")}
            </TabsTab>
            <TabsTab value="labels" className="text-xs">
              {t("cycles:active.statsLabels")}
            </TabsTab>
          </TabsList>
          <div className="max-h-56 overflow-y-auto">
            <TabsPanel value="priority">
              <HighPriorityList cycle={cycle} workspaceId={workspaceId} />
            </TabsPanel>
            <TabsPanel value="assignees">
              <BreakdownList
                items={assignees}
                emptyText={t("planning:breakdown.noAssignees")}
              />
            </TabsPanel>
            <TabsPanel value="labels">
              <BreakdownList
                items={labels}
                emptyText={t("planning:breakdown.noLabels")}
              />
            </TabsPanel>
          </div>
        </Tabs>
      </CardPanel>
    </Card>
  );
}
