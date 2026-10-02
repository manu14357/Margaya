import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type getRecentVisits from "@/fetchers/recent-visit/get-recent-visits";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";
import { getEntityIcon, getEntityPath } from "@/lib/entity-links";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getPriorityIcon } from "@/lib/priority";

export type RecentVisit = Awaited<ReturnType<typeof getRecentVisits>>[number];

type Details = Record<string, unknown> | null;

function stringDetail(details: Details, key: string): string | null {
  const value = details?.[key];
  return typeof value === "string" && value ? value : null;
}

/** Every assignee id (B14a), or the first one alone for older rows. */
export function assigneeIdsOf(details: Details): string[] {
  const ids = details?.assigneeIds;
  if (Array.isArray(ids)) {
    return ids.filter((id): id is string => typeof id === "string");
  }
  const first = stringDetail(details, "assigneeId");
  return first ? [first] : [];
}

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex size-5 items-center justify-center" />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function People({ ids, workspaceId }: { ids: string[]; workspaceId: string }) {
  const people = useTaskAssignees({ assigneeIds: ids }, workspaceId);
  return (
    <AssigneeAvatarStack assignees={people} max={3} size="sm" ring="card" />
  );
}

function TaskProperties({
  details,
  workspaceId,
}: {
  details: Details;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const group = stringDetail(details, "group");
  const priority = stringDetail(details, "priority");
  const meta = isColumnGroup(group) ? COLUMN_GROUP_META[group] : null;
  const GroupIcon = meta?.icon;
  const assigneeIds = assigneeIdsOf(details);

  return (
    <>
      {meta && GroupIcon && (
        <Hint label={t("home:recents.status", { status: t(meta.labelKey) })}>
          <GroupIcon className={`size-3.5 ${meta.iconClassName}`} />
        </Hint>
      )}
      {priority && (
        <Hint
          label={t("home:recents.priority", {
            priority: t(`tasks:priority.${priority}`),
          })}
        >
          {getPriorityIcon(priority)}
        </Hint>
      )}
      {assigneeIds.length > 0 && (
        <People ids={assigneeIds} workspaceId={workspaceId} />
      )}
    </>
  );
}

type RecentRowProps = {
  visit: RecentVisit;
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
};

/** One recent visit. Plain clicks open in place; modified clicks use the href. */
export default function RecentRow({
  visit,
  workspaceId,
  onOpenTask,
}: RecentRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { entity } = visit;
  const path = getEntityPath(entity, workspaceId) ?? "";
  const Icon = getEntityIcon(entity);
  const showKey = entity.type === "task" || entity.type === "project";
  const ownerId = stringDetail(entity.details, "ownerId");

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
    if (entity.type === "task" && entity.projectId) {
      onOpenTask(entity.id, entity.projectId);
      return;
    }
    navigate({ to: path });
  };

  return (
    <li>
      <a
        href={path}
        onClick={handleClick}
        className="flex h-11 items-center gap-3 rounded-md px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {showKey && entity.key && (
            <span className="shrink-0 text-xs font-medium uppercase text-muted-foreground">
              {entity.key}
            </span>
          )}
          <span className="truncate text-sm">{entity.name}</span>
          {!showKey && entity.projectName && (
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {entity.projectName}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {entity.type === "task" && (
            <TaskProperties
              details={entity.details}
              workspaceId={workspaceId}
            />
          )}
          {entity.type === "page" && ownerId && (
            <People ids={[ownerId]} workspaceId={workspaceId} />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <time
                  dateTime={String(visit.visitedAt)}
                  className="text-xs text-muted-foreground"
                />
              }
            >
              {formatRelativeTime(visit.visitedAt)}
            </TooltipTrigger>
            <TooltipContent>
              {t("home:recents.visited", {
                time: formatDateTime(visit.visitedAt),
              })}
            </TooltipContent>
          </Tooltip>
        </span>
      </a>
    </li>
  );
}
