import { format, isValid, parse, startOfDay } from "date-fns";
import type { PackableTask } from "./month-grid-model";

/** How a day is written in the URL and in keys: `2026-11-20`. */
export function toDayKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

/** The local day a `yyyy-MM-dd` key names, or null when it is not one. */
export function parseDayKey(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = parse(value, "yyyy-MM-dd", new Date());
  return isValid(day) ? day : null;
}

/**
 * Every task that covers each day, keyed by `toDayKey`. A multi-day task is
 * listed on each day it spans. Open work comes first, then by start date and
 * title, so the markers and the agenda lead with what still needs doing.
 */
export function groupTasksByDay<TTask extends PackableTask & { title: string }>(
  days: Date[],
  tasks: TTask[],
  isClosed: (task: TTask) => boolean = () => false,
): Map<string, TTask[]> {
  const ordered = tasks
    .map((task) => ({
      task,
      closed: isClosed(task),
      start: startOfDay(task.scheduleStart).getTime(),
      end: startOfDay(task.scheduleEnd).getTime(),
    }))
    .sort(
      (left, right) =>
        Number(left.closed) - Number(right.closed) ||
        left.start - right.start ||
        left.task.title.localeCompare(right.task.title) ||
        left.task.id.localeCompare(right.task.id),
    );

  const byDay = new Map<string, TTask[]>();
  for (const day of days) {
    const time = startOfDay(day).getTime();
    byDay.set(
      toDayKey(day),
      ordered
        .filter(({ start, end }) => start <= time && time <= end)
        .map(({ task }) => task),
    );
  }
  return byDay;
}

/** A day cell shows at most this many markers; the count says the rest. */
export const MAX_DAY_MARKERS = 3;

/**
 * The day the agenda shows: the chosen one while it is on screen, otherwise
 * today when it is, otherwise the first day of the visible month. A week
 * passes no `visibleMonth`: today when it is on screen, else its first day.
 */
export function effectiveSelectedDay(
  selected: Date | null,
  visibleDays: Date[],
  visibleMonth?: Date,
  today: Date = new Date(),
): Date {
  const onScreen = (day: Date) =>
    visibleDays.some((candidate) => toDayKey(candidate) === toDayKey(day));
  if (selected && onScreen(selected)) return selected;
  const inPeriod =
    !visibleMonth ||
    (today.getFullYear() === visibleMonth.getFullYear() &&
      today.getMonth() === visibleMonth.getMonth());
  if (inPeriod && onScreen(today)) return startOfDay(today);
  if (!visibleMonth) return visibleDays[0] ?? startOfDay(today);
  const first = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
  );
  return visibleDays.find((day) => day >= first) ?? visibleDays[0] ?? first;
}
