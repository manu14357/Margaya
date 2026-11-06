import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { getPriorityIcon } from "@/lib/priority";
import type { TaskQueryScope, TaskQueryState } from "@/lib/task-query/model";
import {
  myWorkBaseConditions,
  myWorkDefaultState,
  presetFilters,
} from "@/lib/task-query/my-work";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import WidgetSection, { WidgetError } from "./widget-section";

const LIMIT = 6;
const PRESET = "dueToday";
const SCOPE: TaskQueryScope = { kind: "workspace" };
const BASE_CONDITIONS = myWorkBaseConditions("assigned");

const baseline = myWorkDefaultState();
const STATE: TaskQueryState = {
  ...baseline,
  filters: presetFilters(PRESET),
  display: {
    ...baseline.display,
    groupBy: null,
    orderBy: { field: "priority", direction: "desc" },
  },
};

function DueTodayRow({
  row,
  meta,
  workspaceId,
  onOpenTask,
}: {
  row: TaskQueryRow;
  meta: TaskQueryMeta | undefined;
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
}) {
  const projectName = meta?.projects.find(
    (project) => project.id === row.projectId,
  )?.name;

  // A plain click opens the side sheet; a modified one is left to the browser.
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpenTask(row.id, row.projectId);
  };

  return (
    <li>
      <a
        href={`/dashboard/workspace/${workspaceId}/project/${row.projectId}/task/${row.id}`}
        onClick={handleClick}
        className="flex h-11 items-center gap-3 rounded-md px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {getPriorityIcon(row.priority)}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 font-mono text-muted-foreground text-xs">
            {row.key}
          </span>
          <span className="truncate text-sm">{row.title}</span>
        </span>
        {projectName && (
          <span className="hidden max-w-40 shrink-0 truncate text-muted-foreground text-xs sm:inline">
            {projectName}
          </span>
        )}
      </a>
    </li>
  );
}

type DueTodaySectionProps = {
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
};

/** The open tasks assigned to you that are due today, most urgent first. */
export default function DueTodaySection({
  workspaceId,
  onOpenTask,
}: DueTodaySectionProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useTaskQueryRows({
    workspaceId,
    scope: SCOPE,
    state: STATE,
    baseConditions: BASE_CONDITIONS,
    limit: LIMIT,
    ungrouped: true,
  });
  const rows = (data?.groups ?? [])
    .flatMap((group) => group.taskIds ?? [])
    .flatMap((id) => data?.tasks[id] ?? []);
  const total = data?.totalCount ?? 0;

  return (
    <WidgetSection
      title={t("home:dueToday.title")}
      icon={CalendarClock}
      tone="var(--area-work)"
      actions={
        total > rows.length ? (
          <Button
            variant="ghost"
            size="xs"
            render={
              <Link
                to="/dashboard/workspace/$workspaceId/my-work"
                params={{ workspaceId }}
                search={{ filter: PRESET }}
              />
            }
          >
            {t("home:dueToday.viewAll", { total })}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <ul className="space-y-1" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <li key={index} className="flex h-11 items-center gap-3 px-2">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-4 w-3/5" />
            </li>
          ))}
        </ul>
      ) : isError && rows.length === 0 ? (
        <WidgetError
          message={t("home:dueToday.loadError")}
          retryLabel={t("home:retry")}
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="px-2 text-muted-foreground text-sm">
          {t("home:dueToday.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <DueTodayRow
              key={row.id}
              row={row}
              meta={data?.meta}
              workspaceId={workspaceId}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      )}
    </WidgetSection>
  );
}
