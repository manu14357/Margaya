import { ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn";
import { AvatarStack } from "./avatar";
import {
  type Priority,
  PriorityIcon,
  StatusIcon,
  type StatusId,
} from "./chips";

/**
 * One row of the list layout: priority, key, status, title, then chips and
 * faces on the right. `onStatusClick` makes the status glyph a button
 * (`data-demo="status-<id>"`), like the app's status trigger.
 */
export function TaskListRow({
  id,
  taskKey,
  title,
  status,
  priority = "none",
  assignees = [],
  chips,
  selected = false,
  statusLabel,
  onStatusClick,
  children,
  className,
}: {
  id: string;
  taskKey: string;
  title: ReactNode;
  status: StatusId;
  priority?: Priority;
  assignees?: readonly string[];
  /** Chips before the faces: estimate, due date, labels. */
  chips?: ReactNode;
  selected?: boolean;
  /** The status trigger's accessible name. */
  statusLabel?: string;
  onStatusClick?: () => void;
  /** Rendered after the row, e.g. an open status popover. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-demo={`row-${id}`}
      className={cn(
        "relative border-border/50 border-b",
        selected &&
          "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
        className,
      )}
    >
      <div className="flex min-h-9 items-center gap-2 px-3 py-0.5">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <PriorityIcon priority={priority} className="size-3.5" />
        </span>
        <span className="w-14 shrink-0 truncate font-mono text-muted-foreground text-xs">
          {taskKey}
        </span>
        {onStatusClick ? (
          <button
            type="button"
            data-demo={`status-${id}`}
            aria-label={statusLabel}
            onClick={onStatusClick}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatusIcon status={status} colored className="size-3.5" />
          </button>
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center">
            <StatusIcon status={status} colored className="size-3.5" />
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            status === "done" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        {chips && (
          <span className="flex shrink-0 items-center gap-1">{chips}</span>
        )}
        <AvatarStack names={assignees} max={2} size="sm" />
      </div>
      {children}
    </div>
  );
}

/** A status's column group, whose hue the app's list header wears. */
const GROUP_HUE: Record<StatusId, string> = {
  backlog: "backlog",
  todo: "unstarted",
  inProgress: "started",
  inReview: "started",
  done: "completed",
};

/** The group header's tint, edge hue and count colour for a status. */
export function listGroupStyle(status: StatusId): CSSProperties {
  const hue = GROUP_HUE[status];
  return {
    "--group-color": `var(--status-${hue})`,
    "--group-fg": `var(--status-${hue}-fg)`,
    backgroundColor: `var(--status-${hue}-tint)`,
  } as CSSProperties;
}

/** The header classes that go with `listGroupStyle`. */
export const LIST_GROUP_HEADER =
  "flex h-8 shrink-0 items-center border-border/50 border-b px-3 shadow-[inset_3px_0_0_var(--group-color)]";

/** The group's count pill. */
export function ListGroupCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-card px-1.5 font-medium text-[11px] text-(--group-fg) tabular-nums leading-4 ring-1 ring-(--group-color)/30">
      {count}
    </span>
  );
}

/**
 * A list layout's group header, like the app's: the group's tint with a
 * 3px edge in its hue, then chevron, status glyph, name and a count pill.
 */
export function TaskListGroup({
  status,
  title,
  count,
  "data-demo": target,
}: {
  status: StatusId;
  title: ReactNode;
  count: number;
  "data-demo"?: string;
}) {
  return (
    <div
      data-demo={target}
      data-group={GROUP_HUE[status]}
      className={cn(LIST_GROUP_HEADER, "gap-1.5")}
      style={listGroupStyle(status)}
    >
      <ChevronRight
        aria-hidden
        className="size-3 shrink-0 rotate-90 text-muted-foreground"
      />
      <StatusIcon status={status} colored className="size-3.5" />
      <span className="font-medium text-[13px] text-foreground">{title}</span>
      <ListGroupCount count={count} />
    </div>
  );
}
