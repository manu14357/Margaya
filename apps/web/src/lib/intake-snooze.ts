import { addDays } from "date-fns";
import { formatDate } from "@/lib/format";

// Snoozing a request picks a DAY; the request comes back at the start of
// that day in the viewer's time zone. The API accepts more than a minute
// and at most 366 days ahead, so the calendar offers tomorrow up to today
// plus 365 days.

export const INTAKE_SNOOZE_PRESETS = [
  "tomorrow",
  "in3Days",
  "nextWeek",
  "in2Weeks",
] as const;

export type IntakeSnoozePreset = (typeof INTAKE_SNOOZE_PRESETS)[number];

export const INTAKE_SNOOZE_PRESET_LABEL_KEYS: Record<
  IntakeSnoozePreset,
  `intake:snooze.${IntakeSnoozePreset}`
> = {
  tomorrow: "intake:snooze.tomorrow",
  in3Days: "intake:snooze.in3Days",
  nextWeek: "intake:snooze.nextWeek",
  in2Weeks: "intake:snooze.in2Weeks",
};

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The day a preset lands on (local midnight). "Next week" is the next first
 * day of the week, never today.
 */
export function intakeSnoozePresetDay(
  preset: IntakeSnoozePreset,
  now: Date,
  weekStartsOn: number,
): Date {
  const today = startOfLocalDay(now);
  switch (preset) {
    case "tomorrow":
      return addDays(today, 1);
    case "in3Days":
      return addDays(today, 3);
    case "nextWeek":
      return addDays(today, (weekStartsOn - today.getDay() + 7) % 7 || 7);
    case "in2Weeks":
      return addDays(today, 14);
  }
}

/** The instant the API receives: the start of that day, as ISO with Z. */
export function snoozeInstant(day: Date): string {
  return startOfLocalDay(day).toISOString();
}

/** The calendar's selectable range: tomorrow to today + 365 days. */
export function intakeSnoozeBounds(now: Date): { min: Date; max: Date } {
  const today = startOfLocalDay(now);
  return { min: addDays(today, 1), max: addDays(today, 365) };
}

/** A snooze day such as "Mon, Oct 5". */
export function formatSnoozeDay(value: Date | string, locale?: string) {
  return formatDate(
    value,
    { weekday: "short", month: "short", day: "numeric" },
    locale,
  );
}
