import {
  daysBetween,
  parseCycleDate,
  toCycleDateString,
} from "@/lib/cycle/dates";
import { formatDateMedium, formatDateShort } from "@/lib/format";

// Module dates are date-only strings (YYYY-MM-DD), exactly like cycle dates,
// so the cycle helpers parse them (local midnight) and build them from local
// calendar parts.
export const parseModuleDate = parseCycleDate;
export const toModuleDateString = toCycleDateString;

/** The API draws no chart over more than this many days (inclusive). */
export const MODULE_CHART_MAX_DAYS = 731;

export function formatModuleDate(value: string): string {
  return formatDateMedium(parseModuleDate(value));
}

export type ModuleDateRangeText =
  | { key: "modules:row.noDates" }
  | { key: "modules:row.dateRange"; start: string; end: string }
  | { key: "modules:row.startsOn"; date: string }
  | { key: "modules:row.dueOn"; date: string };

/** "Mar 3 – Apr 16, 2026", "Starts …", "Due …" or "No dates". */
export function moduleDateRangeText(
  startDate: string | null,
  targetDate: string | null,
): ModuleDateRangeText {
  if (startDate && targetDate) {
    return {
      key: "modules:row.dateRange",
      start: formatDateShort(parseModuleDate(startDate)),
      end: formatModuleDate(targetDate),
    };
  }
  if (startDate) {
    return { key: "modules:row.startsOn", date: formatModuleDate(startDate) };
  }
  if (targetDate) {
    return { key: "modules:row.dueOn", date: formatModuleDate(targetDate) };
  }
  return { key: "modules:row.noDates" };
}

/** Whether both dates are set but span more days than the chart covers. */
export function isChartRangeTooLong(
  startDate: string | null,
  targetDate: string | null,
): boolean {
  if (!startDate || !targetDate) return false;
  return daysBetween(startDate, targetDate) + 1 > MODULE_CHART_MAX_DAYS;
}
