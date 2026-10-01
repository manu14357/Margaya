import { useDroppable } from "@dnd-kit/core";
import { format, isWeekend } from "date-fns";
import { Plus } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

type CalendarDayCellProps = {
  day: Date;
  column: number;
  /** Drops are only accepted from people who can edit dates. */
  canDrop: boolean;
  /** Present when the viewer can create tasks. */
  onCreateTask?: (day: Date) => void;
};

/**
 * One day's background: the drop target for rescheduling and the home of
 * the "add a task due this day" button, which shows on hover or focus.
 */
export default function CalendarDayCell({
  day,
  column,
  canDrop,
  onCreateTask,
}: CalendarDayCellProps): JSX.Element {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day:${format(day, "yyyy-MM-dd")}`,
    data: { day },
    disabled: !canDrop,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: column, gridRow: "1 / -1" }}
      data-calendar-day={format(day, "yyyy-MM-dd")}
      className={cn(
        "group/day relative min-w-0 border-r border-border/60 transition-colors",
        isWeekend(day) && "bg-muted/25",
        isOver && "bg-accent/60",
      )}
    >
      {onCreateTask ? (
        <button
          type="button"
          aria-label={t("tasks:calendar.addTaskOn", {
            date: formatDate(day, {
              weekday: "long",
              month: "long",
              day: "numeric",
            }),
          })}
          onClick={() => onCreateTask(day)}
          className="absolute top-1 left-1 z-20 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/day:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
