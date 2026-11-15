import { format, isSameMonth, isToday, isWeekend } from "date-fns";
import { type JSX, type KeyboardEvent, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import type { CalendarTask } from "./calendar-task-bar";
import { MAX_DAY_MARKERS, toDayKey } from "./compact-month-model";
import { visibleDayIndexes } from "./month-grid-model";
import { type ToneInfo, toneOf, toneStyle } from "./status-tone";

type CompactMonthGridProps = {
  /** The month's weeks, or the one week of the week view. */
  weeks: Date[][];
  /**
   * The visible month. Absent in the week view, where no day is outside the
   * period and the days are named by the week's range.
   */
  visibleMonth?: Date;
  /** Every task on each day, keyed by `toDayKey`, in display order. */
  tasksByDay: ReadonlyMap<string, CalendarTask[]>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  showWeekends?: boolean;
  tones?: ReadonlyMap<string, ToneInfo>;
};

/** The day's accessible name: "Thursday, November 20, 3 tasks". */
export function useDayCellLabel() {
  const { t } = useTranslation();
  return (day: Date, count: number) => {
    const date = formatDate(day, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    return count > 0
      ? t("tasks:calendar.touch.dayLabel", { date, count })
      : t("tasks:calendar.touch.dayLabelEmpty", { date });
  };
}

/**
 * The month, or the week as a strip of seven days, as an overview for touch
 * screens and phones: each day is one large button with its date, up to
 * three status markers and a task count. Tapping a day selects it for the
 * agenda. One day is in the tab order and the arrow keys move between days,
 * as in a date picker.
 */
export default function CompactMonthGrid({
  weeks,
  visibleMonth,
  tasksByDay,
  selectedDay,
  onSelectDay,
  showWeekends = true,
  tones,
}: CompactMonthGridProps): JSX.Element {
  const { t } = useTranslation();
  const dayLabel = useDayCellLabel();
  const gridRef = useRef<HTMLDivElement>(null);
  const weekdayTemplate = weeks[0] ?? [];
  const visibleIndexes = useMemo(
    () => visibleDayIndexes(weekdayTemplate, showWeekends),
    [weekdayTemplate, showWeekends],
  );
  const columns = visibleIndexes.length;
  const days = useMemo(
    () => weeks.flatMap((week) => visibleIndexes.map((index) => week[index])),
    [weeks, visibleIndexes],
  );
  const selectedKey = toDayKey(selectedDay);
  const groupLabel = visibleMonth
    ? t("tasks:calendar.touch.daysLabel", {
        month: formatDate(visibleMonth, { month: "long", year: "numeric" }),
      })
    : t("tasks:calendar.touch.weekDaysLabel", {
        start: formatDate(days[0] ?? selectedDay, {
          month: "long",
          day: "numeric",
        }),
        end: formatDate(days.at(-1) ?? selectedDay, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      });

  const moveTo = (index: number) => {
    const day = days[index];
    if (!day) return;
    onSelectDay(day);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-calendar-day="${toDayKey(day)}"]`,
      )
      ?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const rowStart = index - (index % columns);
    const steps: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index - columns,
      ArrowDown: index + columns,
      Home: rowStart,
      End: rowStart + columns - 1,
    };
    const target = steps[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (target >= 0 && target < days.length) moveTo(target);
  };

  const columnTemplate = `repeat(${columns}, minmax(0, 1fr))`;

  return (
    <div
      data-calendar-region={visibleMonth ? "compact-month" : "compact-week"}
      className="shrink-0"
    >
      <div
        aria-hidden="true"
        className="grid border-b border-border bg-background"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {visibleIndexes.map((dayIndex) => {
          const day = weekdayTemplate[dayIndex];
          return (
            <span
              key={`weekday-${day.toISOString()}`}
              data-weekday-label
              className="py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {formatDate(day, { weekday: "short" })}
            </span>
          );
        })}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of day buttons, not a form */}
      <div
        ref={gridRef}
        role="group"
        aria-label={groupLabel}
        className="grid"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {days.map((day, index) => {
          const key = toDayKey(day);
          const dayTasks = tasksByDay.get(key) ?? [];
          const selected = key === selectedKey;
          const today = isToday(day);
          const outside = visibleMonth
            ? !isSameMonth(day, visibleMonth)
            : false;
          return (
            <button
              key={key}
              type="button"
              data-calendar-day={key}
              data-selected={selected || undefined}
              aria-pressed={selected}
              aria-current={today ? "date" : undefined}
              aria-label={dayLabel(day, dayTasks.length)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectDay(day)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "relative flex min-h-14 min-w-0 touch-manipulation flex-col items-center gap-1 border-border/60 border-r border-b px-0.5 pt-1.5 pb-1 outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isWeekend(day) && "bg-(color:--weekend-tint)",
                outside && "bg-muted/50",
                today && "bg-(color:--today-tint)",
                selected
                  ? "bg-primary/10 shadow-[inset_0_0_0_2px_var(--primary)]"
                  : "hover:bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  outside ? "text-muted-foreground" : "text-foreground",
                  selected && "font-semibold",
                  today && "bg-(color:--today) font-semibold text-background",
                )}
              >
                {format(day, "d")}
              </span>
              {dayTasks.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="flex h-3 items-center gap-0.5"
                >
                  {dayTasks.slice(0, MAX_DAY_MARKERS).map((task) => (
                    <span
                      key={task.id}
                      data-day-marker
                      style={toneStyle(toneOf(task.status, tones))}
                      className="size-1.5 shrink-0 rounded-full bg-(color:--tone)"
                    />
                  ))}
                  <span
                    data-day-count
                    className="ml-0.5 text-[10px] font-medium leading-none tabular-nums text-muted-foreground"
                  >
                    {dayTasks.length}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
