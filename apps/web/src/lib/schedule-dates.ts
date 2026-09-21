import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { parseTaskDate } from "./task-schedule";

export type TaskDates = {
  startDate: string | null;
  dueDate: string | null;
};

/**
 * How a calendar day is stored: the viewer's local midnight as an ISO
 * instant, exactly what the date pickers write. Reading it back with
 * `parseTaskDate` lands on the same local day.
 */
export function toTaskDateValue(day: Date): string {
  return startOfDay(day).toISOString();
}

/**
 * Moves a task by whole calendar days. Whichever dates are set move together,
 * so a start and due date keep their span. `addDays` steps calendar days, not
 * 24-hour blocks, so a move across a daylight-saving change still lands on
 * midnight of the intended day.
 */
export function shiftTaskDates(task: TaskDates, days: number): TaskDates {
  const start = parseTaskDate(task.startDate);
  const due = parseTaskDate(task.dueDate);

  return {
    startDate: start ? toTaskDateValue(addDays(start, days)) : task.startDate,
    dueDate: due ? toTaskDateValue(addDays(due, days)) : task.dueDate,
  };
}

/**
 * A calendar drop: the task moves by the distance between the day it was
 * picked up on and the day it was dropped on. For a one-day task that is
 * simply "the due date becomes the drop day"; a longer one keeps its span and
 * the grabbed day lands under the pointer.
 */
export function rescheduleTaskDates(
  task: TaskDates,
  grabbedDay: Date,
  dropDay: Date,
): TaskDates {
  return shiftTaskDates(task, differenceInCalendarDays(dropDay, grabbedDay));
}

/** Default span, in days, that "Schedule" gives an undated task. */
export const DEFAULT_SCHEDULE_SPAN_DAYS = 7;

/**
 * Dates for a task that had none: it starts on `day` and runs `spanDays`
 * calendar days, both ends included.
 */
export function scheduleFromDay(
  day: Date,
  spanDays = DEFAULT_SCHEDULE_SPAN_DAYS,
): { startDate: string; dueDate: string } {
  return {
    startDate: toTaskDateValue(day),
    dueDate: toTaskDateValue(addDays(day, Math.max(1, spanDays) - 1)),
  };
}

/**
 * Which of `dayCount` equal columns a pointer at `clientX` is over, clamped to
 * the strip. Used to tell which day of a multi-day bar was grabbed and which
 * timeline day an item was dropped on.
 */
export function dayIndexAtPointer(
  clientX: number,
  left: number,
  width: number,
  dayCount: number,
): number {
  if (dayCount <= 0 || width <= 0) return 0;
  const index = Math.floor(((clientX - left) / width) * dayCount);
  return Math.max(0, Math.min(dayCount - 1, index));
}
