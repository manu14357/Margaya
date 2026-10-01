import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META, progressPercent } from "@/lib/column-groups";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
// Cycle and module progress reports share these row shapes: the API builds
// both from one schema factory.
import type {
  CycleAssigneeRow,
  CycleCounts,
  CycleLabelRow,
  CyclePriorityRow,
} from "@/types/cycle";

export type BreakdownItem = {
  key: string;
  label: string;
  icon: ReactNode;
  completed: number;
  total: number;
  cancelled: number;
  /** Rows without a filter (e.g. unassigned) are shown but not clickable. */
  disabled?: boolean;
};

type BreakdownListProps = {
  items: BreakdownItem[];
  emptyText?: string;
  isActive?: (item: BreakdownItem) => boolean;
  onToggle?: (item: BreakdownItem) => void;
};

/** Rows of "name  done/total" with a thin progress bar each. */
export function BreakdownList({
  items,
  emptyText,
  isActive,
  onToggle,
}: BreakdownListProps) {
  if (items.length === 0) {
    return emptyText ? (
      <p className="px-2 py-3 text-muted-foreground text-xs">{emptyText}</p>
    ) : null;
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const percent = progressPercent({
          completed: item.completed,
          visible: item.total,
          cancelled: item.cancelled,
        });
        const active = isActive?.(item) ?? false;
        const content = (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {item.completed}/{item.total}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-success"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </span>
          </>
        );
        const className = cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          active && "bg-accent",
        );
        return (
          <li key={item.key}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={active}
                disabled={item.disabled}
                onClick={() => onToggle(item)}
                className={cn(
                  className,
                  "transition-colors hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent",
                )}
              >
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const GROUP_ROWS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

/** One row per column group; done means the group is completed. */
export function useGroupItems(counts: CycleCounts): BreakdownItem[] {
  const { t } = useTranslation();
  return GROUP_ROWS.filter((group) => counts[group] > 0).map((group) => {
    const meta = COLUMN_GROUP_META[group];
    const Icon = meta.icon;
    return {
      key: group,
      label: t(meta.labelKey),
      icon: <Icon className={cn("size-4", meta.iconClassName)} />,
      completed: group === "completed" ? counts[group] : 0,
      total: counts[group],
      cancelled: group === "cancelled" ? counts[group] : 0,
    };
  });
}

export function useAssigneeItems(rows: CycleAssigneeRow[]): BreakdownItem[] {
  const { t } = useTranslation();
  return rows.map((row) => {
    const name = row.name ?? t("planning:breakdown.unassigned");
    return {
      key: row.userId ?? "unassigned",
      label: name,
      icon: row.userId ? (
        <Avatar className="size-5">
          <AvatarImage src={row.image ?? ""} alt={name} />
          <AvatarFallback className="border border-border/30 font-medium text-[9px]">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <span className="size-5 rounded-full border border-border border-dashed" />
      ),
      completed: row.completed,
      total: row.total,
      cancelled: row.cancelled,
      disabled: !row.userId,
    };
  });
}

export function useLabelItems(rows: CycleLabelRow[]): BreakdownItem[] {
  const { t } = useTranslation();
  return rows.map((row) => ({
    key: row.name ?? "no-label",
    label: row.name ?? t("planning:breakdown.noLabel"),
    icon: (
      <span
        className="size-2.5 rounded-full bg-muted-foreground/40"
        style={
          row.color ? { backgroundColor: resolveLabelColor(row.color) } : {}
        }
      />
    ),
    completed: row.completed,
    total: row.total,
    cancelled: row.cancelled,
    disabled: !row.name,
  }));
}

export function priorityItems(rows: CyclePriorityRow[]): BreakdownItem[] {
  return rows.map((row) => ({
    key: row.priority,
    label: getPriorityLabel(row.priority),
    icon: getPriorityIcon(row.priority),
    completed: row.completed,
    total: row.total,
    cancelled: row.cancelled,
  }));
}
