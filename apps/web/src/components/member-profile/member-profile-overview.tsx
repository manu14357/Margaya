import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import MyWorkActivity from "@/components/my-work/my-work-activity";
import { SectionTitle, StatTile } from "@/components/my-work/my-work-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemberWorkSummary } from "@/hooks/queries/task-query/use-member-work-summary";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META } from "@/lib/column-groups";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { MY_WORK_STATE_GROUPS } from "@/lib/task-query/my-work";

type MemberProfileOverviewProps = {
  workspaceId: string;
  userId: string;
  /** Opens the member's assigned list with a preset filter. */
  onOpenAssigned: (preset?: string) => void;
};

/**
 * A member's numbers, their open work by state and by priority, and their
 * recent activity in a side panel (below on phones).
 */
export default function MemberProfileOverview({
  workspaceId,
  userId,
  onOpenAssigned,
}: MemberProfileOverviewProps) {
  const { t } = useTranslation();
  const { summary, isLoading, isError, refetch } = useMemberWorkSummary(
    workspaceId,
    userId,
  );
  const maxPriority = Math.max(
    1,
    ...summary.priorities.map((entry) => entry.count),
  );

  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    preset?: string;
    tone?: "danger";
    accent?: string;
  }> = [
    {
      key: "assignedOpen",
      label: t("team:profile.stats.assignedOpen"),
      value: summary.counts.assignedOpen,
      preset: "open",
      accent: "var(--area-work)",
    },
    {
      key: "overdue",
      label: t("team:profile.stats.overdue"),
      value: summary.counts.overdue,
      preset: "overdue",
      tone: summary.counts.overdue > 0 ? "danger" : undefined,
    },
    {
      key: "completed30",
      label: t("team:profile.stats.completed30"),
      value: summary.counts.completed30,
      preset: "completed30",
      accent: "var(--status-completed-fg)",
    },
    {
      key: "created30",
      label: t("team:profile.stats.created30"),
      value: summary.counts.created30,
      accent: "var(--area-inbox)",
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {isError ? (
          <Card className="flex-row items-center justify-between gap-3 p-4">
            <span className="text-muted-foreground text-sm">
              {t("team:profile.statsError")}
            </span>
            <Button size="sm" variant="outline" onClick={refetch}>
              {t("team:profile.retry")}
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                tone={tile.tone}
                accent={tile.accent}
                value={
                  isLoading ? (
                    <Skeleton className="mt-1 h-6 w-10" />
                  ) : (
                    tile.value
                  )
                }
                onClick={
                  tile.preset ? () => onOpenAssigned(tile.preset) : undefined
                }
              />
            ))}
          </div>
        )}

        <section>
          <SectionTitle>{t("team:profile.workload.byState")}</SectionTitle>
          <Card className="gap-2 p-3">
            {summary.groups.total > 0 ? (
              <GroupProgressBar
                counts={summary.groups}
                cancelledLabel={t("myWork:workload.cancelled", {
                  count: summary.groups.cancelled,
                })}
              />
            ) : (
              !isLoading && (
                <p className="text-muted-foreground text-sm">
                  {t("team:profile.emptyAssigned")}
                </p>
              )
            )}
            <ul className="grid gap-px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {MY_WORK_STATE_GROUPS.map((group) => {
                const meta = COLUMN_GROUP_META[group];
                const Icon = meta.icon;
                return (
                  <li key={group}>
                    <button
                      type="button"
                      onClick={() => onOpenAssigned(`group:${group}`)}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent/50"
                    >
                      <Icon
                        className={cn("size-3.5 shrink-0", meta.iconClassName)}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {t(meta.labelKey)}
                      </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: meta.foreground }}
                      >
                        {isLoading ? "" : summary.groups[group]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>

        <section>
          <SectionTitle>{t("team:profile.workload.priorities")}</SectionTitle>
          <Card className="gap-0.5 p-2">
            {summary.priorities.map((entry) => (
              <button
                key={entry.priority}
                type="button"
                onClick={() => onOpenAssigned(`priority:${entry.priority}`)}
                className="flex h-8 items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-accent/50"
              >
                <span className="inline-flex size-4 items-center justify-center">
                  {getPriorityIcon(entry.priority)}
                </span>
                <span className="w-24 truncate">
                  {getPriorityLabel(entry.priority)}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(entry.count / maxPriority) * 100}%`,
                      backgroundColor: `var(--priority-${entry.priority === "no-priority" ? "none" : entry.priority})`,
                    }}
                  />
                </span>
                <span className="w-8 text-right text-muted-foreground tabular-nums">
                  {entry.count}
                </span>
              </button>
            ))}
          </Card>
        </section>
      </div>

      <aside
        aria-label={t("team:profile.recentActivity")}
        className="min-w-0 lg:sticky lg:top-0 lg:self-start"
      >
        <SectionTitle>{t("team:profile.recentActivity")}</SectionTitle>
        <div className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
          <MyWorkActivity
            workspaceId={workspaceId}
            userId={userId}
            emptyLabel={t("team:profile.emptyActivity")}
          />
        </div>
      </aside>
    </div>
  );
}
