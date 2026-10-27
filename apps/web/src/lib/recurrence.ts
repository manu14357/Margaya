import { i18n } from "./i18n";

// Repeating tasks: the rule shape the API returns, plus the human summary
// ("Every 2 weeks on Mon, Wed") used by the picker, the property row and the
// activity feed. Weekday and month names come from Intl in the UI language.

export const RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export type RecurrenceTrigger = "completion" | "schedule";

export type RecurrenceRuleLike = {
  frequency: RecurrenceFrequency | string;
  interval: number;
  weekdays?: number[] | null;
  monthDay?: number | null;
  /** The current instance's date (YYYY-MM-DD); yearly repeats use its month. */
  anchorDate?: string | null;
  endDate?: string | null;
  maxOccurrences?: number | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function isRecurrenceFrequency(
  value: unknown,
): value is RecurrenceFrequency {
  return RECURRENCE_FREQUENCIES.some((frequency) => frequency === value);
}

function uiLanguage(language?: string): string {
  return language || i18n.resolvedLanguage || i18n.language || "en-US";
}

/** A calendar date ("YYYY-MM-DD") as a UTC-noon Date, safe for formatting. */
function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
}

/** Short weekday names, Sunday first (2026-10-18 is a Sunday). */
export function weekdayNames(
  language?: string,
  style: "short" | "long" = "short",
): string[] {
  const format = new Intl.DateTimeFormat(uiLanguage(language), {
    weekday: style,
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, day) =>
    format.format(new Date(Date.UTC(2026, 9, 18 + day, 12))),
  );
}

/** "Oct 21, 2026" in the UI language, for a calendar date. */
export function formatCalendarDate(value: string, language?: string): string {
  const date = calendarDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(uiLanguage(language), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function list(items: string[], language: string): string {
  try {
    return new Intl.ListFormat(language, {
      style: "narrow",
      type: "conjunction",
    }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** The pattern part: "Every day", "Every 2 weeks on Mon, Wed", … */
function patternSummary(
  rule: RecurrenceRuleLike,
  t: Translate,
  language: string,
): string {
  const count = Math.max(1, rule.interval || 1);
  const anchor = rule.anchorDate ? calendarDate(rule.anchorDate) : null;
  switch (rule.frequency) {
    case "weekly": {
      const names = weekdayNames(language);
      const chosen =
        rule.weekdays && rule.weekdays.length > 0
          ? rule.weekdays
          : anchor
            ? [anchor.getUTCDay()]
            : [];
      const days = list(
        [...chosen].sort((a, b) => a - b).map((day) => names[day] ?? ""),
        language,
      );
      return t("tasks:recurrence.summary.weekly", { count, days });
    }
    case "monthly": {
      const day = rule.monthDay ?? anchor?.getUTCDate() ?? 1;
      return t("tasks:recurrence.summary.monthly", { count, day });
    }
    case "yearly": {
      const month = anchor ? anchor.getUTCMonth() : 0;
      const day = rule.monthDay ?? anchor?.getUTCDate() ?? 1;
      const date = new Intl.DateTimeFormat(language, {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2000, month, day, 12)));
      return t("tasks:recurrence.summary.yearly", { count, date });
    }
    default:
      return t("tasks:recurrence.summary.daily", { count });
  }
}

/** The whole rule in one line, with its end when it has one. */
export function recurrenceSummary(
  rule: RecurrenceRuleLike,
  t: Translate,
  language?: string,
): string {
  const summary = patternSummary(rule, t, uiLanguage(language));
  if (rule.endDate) {
    return t("tasks:recurrence.summary.until", {
      summary,
      date: formatCalendarDate(rule.endDate, language),
    });
  }
  if (rule.maxOccurrences) {
    return t("tasks:recurrence.summary.times", {
      summary,
      count: rule.maxOccurrences,
    });
  }
  return summary;
}
