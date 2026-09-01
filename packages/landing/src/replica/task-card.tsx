import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";
import { AvatarStack } from "./avatar";
import {
  DueChip,
  LabelChip,
  type LabelColor,
  type Priority,
  PriorityChip,
} from "./chips";

export type TaskCardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  /** e.g. "WEB-24", in the mono key line. */
  taskKey?: string;
  labels?: readonly { name: string; color: LabelColor }[];
  priority?: Priority;
  assignees?: readonly string[];
  due?: { label: ReactNode; tone?: "muted" | "soon" | "overdue" };
  selected?: boolean;
  /** Extra chips after the built-in ones. */
  chips?: ReactNode;
  /** `data-demo` target name. */
  "data-demo"?: string;
};

/**
 * The board card: key, title, labels, then priority, due date and faces.
 * With `onClick` it renders as a button, so the replica works by hand.
 */
export function TaskCard({
  title,
  taskKey,
  labels = [],
  priority,
  assignees = [],
  due,
  selected = false,
  chips,
  className,
  ...props
}: TaskCardProps) {
  const classes = cn(
    "group relative block w-full rounded-lg border bg-background px-2.5 py-2 text-left shadow-xs/5 transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:border-border/90 hover:shadow-sm",
    selected
      ? "border-ring/40 bg-accent/50 shadow-sm ring-1 ring-ring/30 ring-inset"
      : "border-border/80",
    props.onClick &&
      "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const body = (
    <>
      {taskKey && (
        <span className="mb-1 block font-mono text-[11px] text-muted-foreground leading-4">
          {taskKey}
        </span>
      )}
      <span className="line-clamp-3 block break-words font-medium text-[13px] text-foreground leading-[18px]">
        {title}
      </span>
      {labels.length > 0 && (
        <span className="mt-1.5 flex min-w-0 flex-wrap gap-1">
          {labels.map((label) => (
            <LabelChip key={label.name} name={label.name} color={label.color} />
          ))}
        </span>
      )}
      <span className="mt-2 flex min-h-5 items-start gap-1">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {priority && <PriorityChip priority={priority} />}
          {due && <DueChip label={due.label} tone={due.tone} />}
          {chips}
        </span>
        <span className="ms-auto flex shrink-0">
          <AvatarStack names={assignees} max={2} size="sm" ring="background" />
        </span>
      </span>
    </>
  );

  if (props.onClick) {
    return (
      <button
        type="button"
        {...props}
        data-selected={selected || undefined}
        className={classes}
      >
        {body}
      </button>
    );
  }
  return (
    <div {...props} data-selected={selected || undefined} className={classes}>
      {body}
    </div>
  );
}
