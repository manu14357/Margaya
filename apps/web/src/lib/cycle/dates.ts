import { parseISO } from "date-fns";
import { formatDateMedium, formatDateShort } from "@/lib/format";
import type { CycleStatus } from "@/types/cycle";

// Cycle dates are date-only strings (YYYY-MM-DD). They are parsed with
// parseISO, which gives local midnight: `new Date(str)` would give UTC
// midnight and show the previous day in negative-offset time zones. Day math
// compares the strings with the server's `today`, never the browser clock.

const DAY_MS = 86_400_000;

export function parseCycleDate(value: string): Date {
  return parseISO(value);
}

/** YYYY-MM-DD from a date's local calendar parts (for picker output). */
export function toCycleDateString(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round(utcDayNumber(to) - utcDayNumber(from));
}

export function formatCycleDate(value: string): string {
  return formatDateMedium(parseCycleDate(value));
}

/** "Mar 3 – Mar 16, 2026", or null for a draft. */
export function formatCycleRange(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null;
  return `${formatDateShort(parseCycleDate(startDate))} – ${formatDateMedium(
    parseCycleDate(endDate),
  )}`;
}

export type CycleBadge =
  | { key: "cycles:badge.noDates" }
  | { key: "cycles:badge.endsToday" }
  | { key: "cycles:badge.startsTomorrow" }
  | { key: "cycles:badge.daysLeft"; count: number }
  | { key: "cycles:badge.startsIn"; count: number }
  | { key: "cycles:badge.ended"; date: string };

/** The time hint a cycle shows next to its status, from the server's today. */
export function cycleBadge(cycle: {
  status: CycleStatus;
  startDate: string | null;
  endDate: string | null;
  today: string;
}): CycleBadge {
  const { startDate, endDate, today } = cycle;
  if (!startDate || !endDate) return { key: "cycles:badge.noDates" };

  if (cycle.status === "current") {
    const left = daysBetween(today, endDate);
    return left <= 0
      ? { key: "cycles:badge.endsToday" }
      : { key: "cycles:badge.daysLeft", count: left };
  }

  if (cycle.status === "upcoming") {
    const until = daysBetween(today, startDate);
    return until <= 1
      ? { key: "cycles:badge.startsTomorrow" }
      : { key: "cycles:badge.startsIn", count: until };
  }

  return { key: "cycles:badge.ended", date: endDate };
}
