import { formatDate } from "@/lib/format";

// Snooze targets (B10 §1.4). Presets add exact durations to "now". A custom
// snooze picks a local date and a half-hour slot, read in the browser's
// time zone. The API accepts 1 minute to 1 year ahead.

const HOUR_MS = 60 * 60 * 1000;
export const SNOOZE_MIN_LEAD_MS = 60 * 1000;

export const SNOOZE_PRESETS = [
  { key: "oneDay", labelKey: "notifications:inbox.snooze.oneDay", hours: 24 },
  {
    key: "threeDays",
    labelKey: "notifications:inbox.snooze.threeDays",
    hours: 72,
  },
  {
    key: "fiveDays",
    labelKey: "notifications:inbox.snooze.fiveDays",
    hours: 120,
  },
  {
    key: "oneWeek",
    labelKey: "notifications:inbox.snooze.oneWeek",
    hours: 7 * 24,
  },
  {
    key: "twoWeeks",
    labelKey: "notifications:inbox.snooze.twoWeeks",
    hours: 14 * 24,
  },
] as const;

export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export function presetTarget(preset: SnoozePreset, now = new Date()): Date {
  return new Date(now.getTime() + preset.hours * HOUR_MS);
}

/** "00:00", "00:30", …, "23:30": the 48 half-hour slots of a day. */
export const SNOOZE_SLOTS: readonly string[] = Array.from(
  { length: 48 },
  (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`,
);

/** The instant of a local calendar date at a "HH:mm" slot. */
export function combineDateAndSlot(date: Date, slot: string): Date {
  const [hours, minutes] = slot.split(":").map(Number);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours ?? 0,
    minutes ?? 0,
    0,
    0,
  );
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The slots that are at least a minute ahead of now on that date. */
export function slotsAllowedFor(date: Date, now = new Date()): string[] {
  const earliest = now.getTime() + SNOOZE_MIN_LEAD_MS;
  return SNOOZE_SLOTS.filter(
    (slot) => combineDateAndSlot(date, slot).getTime() >= earliest,
  );
}

/** 09:00, or the next allowed half hour when that has passed; null if none. */
export function defaultSlot(date: Date, now = new Date()): string | null {
  const allowed = slotsAllowedFor(date, now);
  if (allowed.includes("09:00")) return "09:00";
  return allowed.find((slot) => slot > "09:00") ?? allowed[0] ?? null;
}

/** A slot as the user's locale writes a time, e.g. "3:30 PM". */
export function formatSlotLabel(slot: string, locale?: string): string {
  return formatDate(
    combineDateAndSlot(new Date(2000, 0, 1), slot),
    { hour: "numeric", minute: "2-digit" },
    locale,
  );
}

/** A snooze target such as "Fri, Sep 26, 3:40 PM". */
export function formatSnoozeTarget(value: Date | string, locale?: string) {
  return formatDate(
    value,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    locale,
  );
}
