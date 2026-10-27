import type { LucideIcon } from "lucide-react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Inbox,
} from "lucide-react";

// Mirrors the API's column groups. Every column belongs to one group, which
// says whether its tasks are waiting, in progress, completed or cancelled.
// `triage` is reserved for intake and is never offered in pickers.
export const COLUMN_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
  "triage",
] as const;

export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export const CREATABLE_COLUMN_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const satisfies readonly ColumnGroup[];

export type CreatableColumnGroup = (typeof CREATABLE_COLUMN_GROUPS)[number];

export const DEFAULT_COLUMN_GROUP: CreatableColumnGroup = "unstarted";

type ColumnGroupMeta = {
  icon: LucideIcon;
  labelKey: `tasks:columnGroups.${ColumnGroup}.label`;
  descriptionKey: `tasks:columnGroups.${ColumnGroup}.description`;
  /** Status hue from `--status-*` in styles/semantic-colors.css. */
  iconClassName: string;
  barClassName: string;
  /** The raw status variables, for inline tints (dots, header bands). */
  color: string;
  tint: string;
  foreground: string;
  /** Fixed order for pickers and aggregations; never forces the board order. */
  rank: number;
};

export const COLUMN_GROUP_META: Record<ColumnGroup, ColumnGroupMeta> = {
  triage: {
    icon: Inbox,
    labelKey: "tasks:columnGroups.triage.label",
    descriptionKey: "tasks:columnGroups.triage.description",
    iconClassName: "text-muted-foreground",
    barClassName: "bg-muted-foreground/20",
    color: "var(--status-backlog)",
    tint: "var(--status-backlog-tint)",
    foreground: "var(--status-backlog-fg)",
    rank: -1,
  },
  backlog: {
    icon: CircleDashed,
    labelKey: "tasks:columnGroups.backlog.label",
    descriptionKey: "tasks:columnGroups.backlog.description",
    iconClassName: "text-(--status-backlog)",
    barClassName: "bg-(--status-backlog)",
    color: "var(--status-backlog)",
    tint: "var(--status-backlog-tint)",
    foreground: "var(--status-backlog-fg)",
    rank: 0,
  },
  unstarted: {
    icon: Circle,
    labelKey: "tasks:columnGroups.unstarted.label",
    descriptionKey: "tasks:columnGroups.unstarted.description",
    iconClassName: "text-(--status-unstarted)",
    barClassName: "bg-(--status-unstarted)",
    color: "var(--status-unstarted)",
    tint: "var(--status-unstarted-tint)",
    foreground: "var(--status-unstarted-fg)",
    rank: 1,
  },
  started: {
    icon: CircleDot,
    labelKey: "tasks:columnGroups.started.label",
    descriptionKey: "tasks:columnGroups.started.description",
    iconClassName: "text-(--status-started)",
    barClassName: "bg-(--status-started)",
    color: "var(--status-started)",
    tint: "var(--status-started-tint)",
    foreground: "var(--status-started-fg)",
    rank: 2,
  },
  completed: {
    icon: CircleCheck,
    labelKey: "tasks:columnGroups.completed.label",
    descriptionKey: "tasks:columnGroups.completed.description",
    iconClassName: "text-(--status-completed)",
    barClassName: "bg-(--status-completed)",
    color: "var(--status-completed)",
    tint: "var(--status-completed-tint)",
    foreground: "var(--status-completed-fg)",
    rank: 3,
  },
  cancelled: {
    icon: CircleX,
    labelKey: "tasks:columnGroups.cancelled.label",
    descriptionKey: "tasks:columnGroups.cancelled.description",
    iconClassName: "text-(--status-cancelled)",
    barClassName: "bg-(--status-cancelled)",
    color: "var(--status-cancelled)",
    tint: "var(--status-cancelled-tint)",
    foreground: "var(--status-cancelled-fg)",
    rank: 4,
  },
};

export type ColumnLike = {
  slug: string;
  position?: number | null;
  group?: string | null;
  isFinal?: boolean | null;
};

export function isColumnGroup(value: unknown): value is ColumnGroup {
  return (
    typeof value === "string" &&
    (COLUMN_GROUPS as readonly string[]).includes(value)
  );
}

export function isClosedGroup(group: string | null | undefined): boolean {
  return group === "completed" || group === "cancelled";
}

export function isOpenGroup(group: string | null | undefined): boolean {
  return group === "backlog" || group === "unstarted" || group === "started";
}

/**
 * A column's group. Columns cached before groups existed carry only
 * `isFinal`, which maps to completed or not started.
 */
export function columnGroupOf(column: ColumnLike): ColumnGroup {
  if (isColumnGroup(column.group)) return column.group;
  return column.isFinal ? "completed" : DEFAULT_COLUMN_GROUP;
}

function byPosition<T extends ColumnLike>(columns: readonly T[]): T[] {
  return columns
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (a.column.position ?? a.index) - (b.column.position ?? b.index) ||
        a.index - b.index,
    )
    .map(({ column }) => column);
}

export function withoutTriage<T extends ColumnLike>(
  columns: readonly T[],
): T[] {
  return columns.filter((column) => columnGroupOf(column) !== "triage");
}

/**
 * The group of a task with this status. `planned` counts as backlog,
 * `archived` belongs to no group, and a slug without a column (legacy data)
 * is treated as not started.
 */
export function taskGroupOf(
  status: string,
  columns: readonly ColumnLike[],
): ColumnGroup | null {
  if (status === "planned") return "backlog";
  if (status === "archived") return null;
  const column = columns.find((candidate) => candidate.slug === status);
  return column ? columnGroupOf(column) : DEFAULT_COLUMN_GROUP;
}

/**
 * Where new and reopened work goes: the first not-started column, else the
 * first open column, by board position.
 */
export function getEntryColumn<T extends ColumnLike>(
  columns: readonly T[],
): T | undefined {
  const ordered = byPosition(columns);
  return (
    ordered.find((column) => columnGroupOf(column) === "unstarted") ??
    ordered.find((column) => isOpenGroup(columnGroupOf(column)))
  );
}

/** The first completed-group column by board position. */
export function getCompletedColumn<T extends ColumnLike>(
  columns: readonly T[],
): T | undefined {
  return byPosition(columns).find(
    (column) => columnGroupOf(column) === "completed",
  );
}

/**
 * Completion percentage. Cancelled work leaves both sides of the ratio;
 * nothing visible gives 0 and everything cancelled gives 100.
 */
export function progressPercent({
  completed,
  visible,
  cancelled,
}: {
  completed: number;
  visible: number;
  cancelled: number;
}): number {
  if (visible <= 0) return 0;
  const counted = visible - cancelled;
  if (counted <= 0) return 100;
  return Math.round((completed / counted) * 100);
}

/** Columns ordered by group rank, keeping board order inside a group. */
export function sortColumnsByGroup<T extends ColumnLike>(
  columns: readonly T[],
): T[] {
  const ordered = byPosition(columns);
  return ordered
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        COLUMN_GROUP_META[columnGroupOf(a.column)].rank -
          COLUMN_GROUP_META[columnGroupOf(b.column)].rank || a.index - b.index,
    )
    .map(({ column }) => column);
}
