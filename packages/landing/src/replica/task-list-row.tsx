import type { ReactNode } from "react";
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

/** A list layout's group header: status glyph, name, count. */
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
      className="flex h-8 shrink-0 items-center gap-2 border-border/50 border-b bg-muted/50 px-3"
    >
      <StatusIcon status={status} colored className="size-3.5" />
      <span className="font-medium text-[13px] text-foreground">{title}</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {count}
      </span>
    </div>
  );
}
