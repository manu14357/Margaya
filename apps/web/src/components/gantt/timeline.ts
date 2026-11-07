import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import type { GanttZoom } from "@/store/schedule-view-preferences";

export const GANTT_WINDOW_DAYS = 91;

/**
 * Each zoom level is a day-column width plus how many days one window holds.
 * Month is the original scale (and the default); Week spreads a month over
 * wide columns, Quarter fits about half a year into the same space.
 */
const ZOOM_SCALES: Record<
  GanttZoom,
  { desktopRem: number; mobileRem: number; windowDays: number }
> = {
  week: { desktopRem: 6, mobileRem: 4.5, windowDays: 28 },
  month: { desktopRem: 2.75, mobileRem: 3.125, windowDays: GANTT_WINDOW_DAYS },
  quarter: { desktopRem: 1, mobileRem: 1.25, windowDays: 182 },
};

export function ganttZoomScale(zoom: GanttZoom, isMobile: boolean) {
  const scale = ZOOM_SCALES[zoom] ?? ZOOM_SCALES.month;
  return {
    dayColumnWidthRem: isMobile ? scale.mobileRem : scale.desktopRem,
    windowDays: scale.windowDays,
    // Day numbers do not fit a quarter's narrow columns, so only the first
    // day of each week is labelled there.
    labelEveryDay: zoom !== "quarter",
  };
}

/** Whether a header cell prints its day number at this zoom. */
export function showsDayNumber(
  day: Date,
  index: number,
  labelEveryDay: boolean,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): boolean {
  return labelEveryDay || index === 0 || day.getDay() === weekStartsOn;
}
const minimumDate = parseISO("0001-01-01");
const maximumDate = parseISO("9999-12-31");

export function parseTaskDate(value: string | null) {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ||
    parsed < minimumDate ||
    startOfDay(parsed) > maximumDate
    ? null
    : parsed;
}

/**
 * Where a task sits on the timeline, or null without a usable date. Reversed
 * dates are put in order; a milestone is one day, its due date.
 */
export function taskScheduleSpan(task: {
  startDate: string | null;
  dueDate: string | null;
  isMilestone?: boolean;
}): { scheduleStart: Date; scheduleEnd: Date } | null {
  const start = parseTaskDate(task.startDate) ?? parseTaskDate(task.dueDate);
  const end = parseTaskDate(task.dueDate) ?? parseTaskDate(task.startDate);
  if (!start || !end) return null;
  if (task.isMilestone) return { scheduleStart: end, scheduleEnd: end };
  return {
    scheduleStart: start <= end ? start : end,
    scheduleEnd: end >= start ? end : start,
  };
}

/** A rem length (the task list's or a day column's width) in pixels. */
export function remToPx(width: string): number | null {
  const rem = Number.parseFloat(width);
  if (!Number.isFinite(rem)) return null;
  const rootSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return rem * (Number.isFinite(rootSize) ? rootSize : 16);
}

/**
 * The scroll offset that centres a day beside the task list, rounded to a
 * whole column so the first visible day is never cut in half at its edge.
 * Columns are fixed-width, so a multiple of their width lines one up there.
 */
export function centredDayScrollLeft({
  dayIndex,
  dayCount,
  columnPx,
  viewportPx,
  railPx,
}: {
  dayIndex: number;
  dayCount: number;
  columnPx: number;
  /** The scroll container's width, task list included. */
  viewportPx: number;
  railPx: number;
}): number {
  if (!(columnPx > 0)) return 0;
  const visible = Math.max(1, Math.floor((viewportPx - railPx) / columnPx));
  const lastFirst = Math.max(
    0,
    Math.floor((railPx + dayCount * columnPx - viewportPx) / columnPx),
  );
  const first = Math.min(
    lastFirst,
    Math.max(0, dayIndex - Math.floor(visible / 2)),
  );
  return first * columnPx;
}

function clampDate(date: Date, minimum: Date, maximum: Date) {
  return new Date(
    Math.max(minimum.getTime(), Math.min(date.getTime(), maximum.getTime())),
  );
}

export function buildGanttTimeline(
  tasks: { scheduleStart: Date; scheduleEnd: Date }[],
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  dayColumnWidthRem: number,
  requestedStart: Date | null = null,
  today: Date = new Date(),
  windowDays: number = GANTT_WINDOW_DAYS,
) {
  if (tasks.length === 0) return null;
  let earliest = tasks[0].scheduleStart;
  let latest = tasks[0].scheduleEnd;
  for (const task of tasks) {
    if (task.scheduleStart < earliest) earliest = task.scheduleStart;
    if (task.scheduleEnd > latest) latest = task.scheduleEnd;
  }
  const minimumStart = clampDate(
    subDays(startOfWeek(earliest, { weekStartsOn }), 7),
    minimumDate,
    maximumDate,
  );
  const maximumEnd = clampDate(
    startOfDay(addDays(endOfWeek(latest, { weekStartsOn }), 28)),
    minimumDate,
    maximumDate,
  );
  const maximumStart = new Date(
    Math.max(
      minimumStart.getTime(),
      subDays(maximumEnd, windowDays - 1).getTime(),
    ),
  );
  const fits = differenceInCalendarDays(maximumEnd, minimumStart) < windowDays;
  const anchor = today >= earliest && today <= latest ? today : earliest;
  const defaultStart = fits
    ? minimumStart
    : subDays(startOfWeek(anchor, { weekStartsOn }), 7);
  const rangeStart = startOfDay(
    clampDate(
      requestedStart && !Number.isNaN(requestedStart.getTime())
        ? requestedStart
        : defaultStart,
      minimumStart,
      maximumStart,
    ),
  );
  const rangeEnd = clampDate(
    addDays(rangeStart, windowDays - 1),
    rangeStart,
    maximumEnd,
  );
  // Bound BEFORE allocating Date objects or grid columns, including old/imported
  // tasks whose dates were never checked by today's API validation.
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  return {
    days,
    windowDays,
    rangeStart,
    rangeEnd,
    minimumStart,
    maximumStart,
    hasPrevious: rangeStart > minimumStart,
    hasNext: rangeEnd < maximumEnd,
    gridTemplateColumns: `repeat(${days.length}, minmax(${dayColumnWidthRem}rem, ${dayColumnWidthRem}rem))`,
    timelineMinWidthRem: days.length * dayColumnWidthRem,
  };
}
