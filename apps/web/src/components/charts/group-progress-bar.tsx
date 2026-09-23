import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META } from "@/lib/column-groups";

export type GroupCounts = {
  total: number;
  backlog: number;
  unstarted: number;
  started: number;
  completed: number;
  cancelled: number;
};

const SEGMENTS = ["completed", "started", "unstarted", "backlog"] as const;

type GroupProgressBarProps = {
  counts: GroupCounts;
  /** Shown beside the bar when some work was cancelled, e.g. "2 cancelled". */
  cancelledLabel?: string;
  className?: string;
};

/**
 * A stacked bar of work by column group (completed, started, not started,
 * backlog). Cancelled work is out of scope, so it is counted beside the bar.
 * Shared by cycles and modules; renders nothing without tasks.
 */
export default function GroupProgressBar({
  counts,
  cancelledLabel,
  className,
}: GroupProgressBarProps) {
  const { t } = useTranslation();
  if (counts.total === 0) return null;
  const scope = counts.total - counts.cancelled;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex h-2 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
        {scope > 0 &&
          SEGMENTS.filter((group) => counts[group] > 0).map((group) => {
            const meta = COLUMN_GROUP_META[group];
            const label = `${t(meta.labelKey)}: ${counts[group]}`;
            return (
              <div
                key={group}
                role="img"
                aria-label={label}
                title={label}
                className={cn(
                  "h-full first:rounded-l-full last:rounded-r-full",
                  meta.barClassName,
                )}
                style={{ width: `${(counts[group] / scope) * 100}%` }}
              />
            );
          })}
      </div>
      {counts.cancelled > 0 && cancelledLabel && (
        <span className="shrink-0 text-muted-foreground text-xs">
          {cancelledLabel}
        </span>
      )}
    </div>
  );
}
