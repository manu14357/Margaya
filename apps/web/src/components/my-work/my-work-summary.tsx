import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import MyWorkActivity from "@/components/my-work/my-work-activity";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyWorkSummary } from "@/hooks/queries/task-query/use-my-work-summary";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META } from "@/lib/column-groups";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import {
  MY_WORK_STATE_GROUPS,
  type MyWorkListTab,
} from "@/lib/task-query/my-work";

type MyWorkSummaryProps = {
  workspaceId: string;
  /** Opens a list tab with a preset filter (open, overdue, a project). */
  onOpen: (tab: MyWorkListTab, preset?: string) => void;
};

export function StatTile({
  label,
  value,
  onClick,
  tone,
  accent,
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  tone?: "danger";
  /** The number's hue (a CSS colour); `tone="danger"` wins. */
  accent?: string;
}) {
  const content = (
    <>
      <span className="max-w-full truncate text-muted-foreground text-xs">
        {label}
      </span>
      <span
        className={cn(
          "font-semibold text-xl tabular-nums",
          tone === "danger" && "text-destructive-foreground",
        )}
        style={tone !== "danger" && accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </>
  );
  return (
    <Card className="overflow-hidden p-0">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full flex-col items-start gap-0.5 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-0.5 px-3 py-2.5">
          {content}
        </div>
      )}
    </Card>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
      {children}
    </h2>
  );
}

/**
 * "Your work" summary: me, my numbers, my work grouped by state, priority
 * and project, with my recent activity in a side panel (below on phones).
 */
export default function MyWorkSummary({
  workspaceId,
  onOpen,
}: MyWorkSummaryProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: member } = useGetActiveWorkspaceUser();
  const { summary, isLoading, isError, refetch } =
    useMyWorkSummary(workspaceId);
  const maxPriority = Math.max(
    1,
    ...summary.priorities.map((entry) => entry.count),
  );

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-muted-foreground text-sm">{t("myWork:loadError")}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          {t("myWork:retry")}
        </Button>
      </div>
    );
  }

  const tiles: Array<{
    key: string;
    label: string;
    value: number | null;
    tab?: MyWorkListTab;
    preset?: string;
    tone?: "danger";
    accent?: string;
  }> = [
    {
      key: "assignedOpen",
      label: t("myWork:stats.assignedOpen"),
      value: summary.counts.assignedOpen,
      tab: "assigned",
      preset: "open",
      accent: "var(--area-work)",
    },
    {
      key: "overdue",
      label: t("myWork:stats.overdue"),
      value: summary.counts.overdue,
      tab: "assigned",
      preset: "overdue",
      tone: summary.counts.overdue > 0 ? "danger" : undefined,
    },
    {
      key: "dueThisWeek",
      label: t("myWork:stats.dueThisWeek"),
      value: summary.counts.dueThisWeek,
      tab: "assigned",
      preset: "dueThisWeek",
      accent: "var(--status-started-fg)",
    },
    {
      key: "completed30",
      label: t("myWork:stats.completed30"),
      value: summary.counts.completed30,
      tab: "assigned",
      preset: "completed30",
      accent: "var(--status-completed-fg)",
    },
    {
      key: "created",
      label: t("myWork:stats.created"),
      value: summary.counts.created,
      tab: "created",
      accent: "var(--area-inbox)",
    },
    {
      key: "subscribed",
      label: t("myWork:stats.subscribed"),
      value: summary.counts.subscribed,
      tab: summary.counts.subscribed === null ? undefined : "subscribed",
      accent: "var(--area-analytics)",
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarImage src={user?.image ?? ""} alt={user?.name ?? ""} />
            <AvatarFallback className="text-sm">
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-base leading-6">
              {user?.name}
            </h2>
            <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
              <span className="truncate">{user?.email}</span>
              {member?.role && (
                <span>{t("myWork:profile.role", { role: member.role })}</span>
              )}
              {member?.createdAt && (
                <span>
                  {t("myWork:profile.memberSince", {
                    date: formatDateMedium(member.createdAt),
                  })}
                </span>
              )}
              {user?.id && (
                <Link
                  to="/dashboard/workspace/$workspaceId/profile/$userId"
                  params={{ workspaceId, userId: user.id }}
                  className="hover:text-foreground hover:underline"
                >
                  {t("myWork:profile.viewProfile")}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              tone={tile.tone}
              accent={tile.accent}
              value={
                isLoading ? (
                  <Skeleton className="mt-1 h-6 w-10" />
                ) : tile.value === null ? (
                  t("myWork:stats.notAvailable")
                ) : (
                  tile.value
                )
              }
              onClick={
                tile.tab
                  ? () => onOpen(tile.tab as MyWorkListTab, tile.preset)
                  : undefined
              }
            />
          ))}
        </div>

        <section>
          <SectionTitle>{t("myWork:workload.byState")}</SectionTitle>
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
                  {t("myWork:empty.assigned")}
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
                      onClick={() => onOpen("assigned", `group:${group}`)}
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

        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <SectionTitle>{t("myWork:workload.priorities")}</SectionTitle>
            <Card className="gap-0.5 p-2">
              {summary.priorities.map((entry) => (
                <button
                  key={entry.priority}
                  type="button"
                  onClick={() =>
                    onOpen("assigned", `priority:${entry.priority}`)
                  }
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

          <section>
            <SectionTitle>{t("myWork:workload.byProject")}</SectionTitle>
            <Card className="p-0">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-border/60 border-b px-3 py-1.5 text-muted-foreground text-xs">
                <span>{t("myWork:byProject.project")}</span>
                <span className="w-14 text-right">
                  {t("myWork:byProject.open")}
                </span>
                <span className="w-20 text-right">
                  {t("myWork:byProject.completed")}
                </span>
              </div>
              {summary.projects.length === 0 && !isLoading && (
                <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                  {t("myWork:empty.assigned")}
                </p>
              )}
              {summary.projects.map((project) => {
                return (
                  <button
                    key={project.projectId}
                    type="button"
                    onClick={() =>
                      onOpen("assigned", `project:${project.projectId}`)
                    }
                    className="grid h-8 w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 border-border/40 border-b px-3 text-left text-sm last:border-b-0 hover:bg-accent/40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ProjectTile
                        icon={project.icon}
                        seed={project.projectId}
                      />
                      <span className="truncate">{project.name}</span>
                    </span>
                    <span className="w-14 text-right tabular-nums">
                      {project.open}
                    </span>
                    <span className="w-20 text-right text-muted-foreground tabular-nums">
                      {project.completed}
                    </span>
                  </button>
                );
              })}
            </Card>
          </section>
        </div>
      </div>

      <aside
        aria-label={t("myWork:workload.recentActivity")}
        className="min-w-0 lg:sticky lg:top-0 lg:self-start"
      >
        <SectionTitle>{t("myWork:workload.recentActivity")}</SectionTitle>
        <div className="lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
          <MyWorkActivity workspaceId={workspaceId} />
        </div>
      </aside>
    </div>
  );
}
