import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsOverview } from "@/types/analytics";
import AnalyticsSection from "./analytics-section";
import { ProjectIcon } from "./category-label";

const VISIBLE_ROWS = 8;

type ProjectRow = AnalyticsOverview["projectRows"][number];

function openOf(row: ProjectRow) {
  return row.backlog + row.unstarted + row.started;
}

/** Most open tasks first; ties keep the project order. */
export function sortProjectRows(rows: readonly ProjectRow[]): ProjectRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => openOf(b.row) - openOf(a.row) || a.index - b.index)
    .map(({ row }) => row);
}

function RowsSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 5 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-2 flex-1" />
        </div>
      ))}
    </div>
  );
}

type ProjectProgressCardProps = {
  workspaceId: string;
  overview: AnalyticsOverview | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
};

/** One row per scope project: progress by group, completion and open work. */
export default function ProjectProgressCard({
  workspaceId,
  overview,
  isLoading,
  error,
  onRetry,
  className,
}: ProjectProgressCardProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const rows = overview ? sortProjectRows(overview.projectRows) : [];
  const shown = showAll ? rows : rows.slice(0, VISIBLE_ROWS);
  const projectOf = (id: string) =>
    overview?.meta.projects.find((project) => project.id === id);

  return (
    <AnalyticsSection
      title={t("analytics:overview.projectProgress")}
      subtitle={t("analytics:overview.projectProgressSubtitle")}
      isLoading={isLoading}
      skeleton={<RowsSkeleton />}
      error={error}
      onRetry={onRetry}
      isEmpty={rows.length === 0}
      emptyTitle={t("analytics:states.noTasks")}
      className={className}
    >
      <ul className="grid gap-1">
        {shown.map((row) => {
          const project = projectOf(row.projectId);
          return (
            <li key={row.projectId}>
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/board"
                params={{ workspaceId, projectId: row.projectId }}
                className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 py-1.5 text-xs hover:bg-accent/40 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3rem_5rem]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProjectIcon icon={project?.icon} />
                  <span className="truncate font-medium text-sm">
                    {project?.name ?? row.projectId}
                  </span>
                </span>
                <span className="min-w-0">
                  {row.total > 0 ? (
                    <GroupProgressBar counts={row} />
                  ) : (
                    <span className="block h-2 rounded-full bg-muted" />
                  )}
                </span>
                <span className="text-right tabular-nums">{row.progress}%</span>
                <span className="hidden text-right text-muted-foreground tabular-nums sm:block">
                  {t("analytics:overview.open", { count: openOf(row) })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.length > VISIBLE_ROWS && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("analytics:overview.showLess")
              : t("analytics:overview.showAll", { count: rows.length })}
          </Button>
        </div>
      )}
    </AnalyticsSection>
  );
}
