import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  CalendarDays,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Circle as CircleIcon,
  Minus,
  Search,
  X,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/*
 * The app's chips, simplified: same tokens, radii and type sizes as the
 * board card, capture bar and property grid.
 */

export type StatusId = "backlog" | "todo" | "inProgress" | "inReview" | "done";

const STATUS_ICON: Record<StatusId, LucideIcon> = {
  backlog: CircleDashed,
  todo: CircleIcon,
  inProgress: CircleDot,
  inReview: Search,
  done: CircleCheck,
};

const STATUS_TONE: Record<StatusId, string> = {
  backlog: "text-muted-foreground",
  todo: "text-info-foreground",
  inProgress: "text-warning-foreground",
  inReview: "text-warning-foreground",
  done: "text-success-foreground",
};

/** A status glyph. Muted like the board headers, or `colored` by group. */
export function StatusIcon({
  status,
  colored = false,
  className,
}: {
  status: StatusId;
  colored?: boolean;
  className?: string;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        colored ? STATUS_TONE[status] : "text-muted-foreground",
        className,
      )}
    />
  );
}

/** The read-only status chip of the task sheet header. */
export function StatusChip({
  status,
  label,
  className,
}: {
  status: StatusId;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full border border-input bg-background px-2 font-medium text-foreground text-xs dark:bg-input/32",
        className,
      )}
    >
      <StatusIcon status={status} colored className="size-3" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

/** The app's priority glyphs and colours. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  const classes = cn("size-3 shrink-0", className);
  switch (priority) {
    case "urgent":
      return (
        <CircleAlert
          aria-hidden
          className={cn(classes, "text-destructive-foreground")}
        />
      );
    case "high":
      return (
        <ChevronsUp
          aria-hidden
          className={cn(classes, "text-warning-foreground")}
        />
      );
    case "medium":
      return (
        <ChevronUp
          aria-hidden
          className={cn(classes, "text-warning-foreground/80")}
        />
      );
    case "low":
      return (
        <ChevronDown
          aria-hidden
          className={cn(classes, "text-info-foreground/85")}
        />
      );
    default:
      return (
        <Minus aria-hidden className={cn(classes, "text-muted-foreground")} />
      );
  }
}

/** The small priority box on a board card. */
export function PriorityChip({
  priority,
  label,
}: {
  priority: Priority;
  /** Shown next to the glyph; omit for the glyph alone (board cards). */
  label?: ReactNode;
}) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-1.5 font-medium text-[10px] text-muted-foreground">
      <PriorityIcon priority={priority} />
      {label}
    </span>
  );
}

/** Label colours: the app's palette, as Tailwind colour variables. */
export const LABEL_COLORS = {
  gray: "var(--color-stone-500)",
  slate: "var(--color-slate-500)",
  purple: "var(--color-violet-500)",
  teal: "var(--color-emerald-600)",
  green: "var(--color-green-600)",
  yellow: "var(--color-amber-600)",
  orange: "var(--color-orange-600)",
  pink: "var(--color-rose-600)",
  red: "var(--color-red-600)",
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;

export function LabelDot({
  color,
  className,
}: {
  color: LabelColor;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: LABEL_COLORS[color] }}
    />
  );
}

/** An outlined label badge with its colour dot. */
export function LabelChip({
  name,
  color,
  className,
}: {
  name: ReactNode;
  color: LabelColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4.5 min-w-0 max-w-full items-center gap-1 rounded-sm border border-input bg-background px-2 font-medium text-[10px] text-foreground dark:bg-input/32",
        className,
      )}
    >
      <LabelDot color={color} />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

/** A due-date chip on a card. */
export function DueChip({
  label,
  tone = "muted",
}: {
  label: ReactNode;
  tone?: "muted" | "soon" | "overdue";
}) {
  return (
    <span
      className={cn(
        "flex h-5 items-center gap-1 rounded px-1.5 text-[10px]",
        tone === "overdue"
          ? "bg-destructive/10 text-destructive-foreground"
          : tone === "soon"
            ? "bg-warning/10 text-warning-foreground"
            : "bg-muted/50 text-muted-foreground",
      )}
    >
      <CalendarDays aria-hidden className="size-3" />
      {label}
    </span>
  );
}

/** A parsed capture-bar token: `@person`, `#label`, `!priority` or a date. */
export function TokenChip({
  kind,
  children,
  color,
  priority,
}: {
  kind: "assignee" | "label" | "priority" | "date";
  children: ReactNode;
  color?: LabelColor;
  priority?: Priority;
}) {
  return (
    <span
      data-token={kind}
      className="inline-flex h-5 max-w-48 items-center gap-1 rounded-full border border-border bg-background ps-1.5 pe-0.5 text-foreground text-xs"
    >
      {kind === "assignee" && (
        <AtSign aria-hidden className="size-3 text-muted-foreground" />
      )}
      {kind === "label" && (
        <LabelDot color={color ?? "gray"} className="size-2" />
      )}
      {kind === "priority" && <PriorityIcon priority={priority ?? "none"} />}
      {kind === "date" && (
        <CalendarDays aria-hidden className="size-3 text-muted-foreground" />
      )}
      <span className="truncate">{children}</span>
      <span className="flex size-4 items-center justify-center rounded-full text-muted-foreground">
        <X aria-hidden className="size-3" />
      </span>
    </span>
  );
}

/** A filter-bar chip, e.g. "Assignee: Adam". */
export function FilterChip({
  children,
  icon: Icon,
  ...props
}: ComponentProps<"span"> & { icon?: LucideIcon }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 font-medium text-foreground text-xs dark:bg-input/32",
        props.className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 text-muted-foreground" />}
      {children}
    </span>
  );
}

/** A key cap, like the app's `Kbd`. */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded bg-muted px-1 font-medium font-sans text-muted-foreground text-xs",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
