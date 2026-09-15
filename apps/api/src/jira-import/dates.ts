// Jira writes dates in the exporting user's format and time zone, without an
// offset: "12/Mar/24 3:45 PM" (dd/MMM/yy h:mm a) by default, sometimes with
// a four-digit year or a 24-hour clock, and ISO 8601 on some instances.
// Wall-clock values are read in the importer's time zone.

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const JIRA_DATE =
  /^(\d{1,2})[/\- ]([A-Za-z]{3,9})\.?[/\- ](\d{2}|\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type ParsedJiraDate = {
  date: Date;
  /** True when the value had no time of day (a calendar day). */
  dateOnly: boolean;
};

/** A valid IANA time zone, else UTC. */
export function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - (instant - (instant % 1000));
}

/** The instant a wall-clock time shows in a time zone. */
export function wallTimeToDate(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (timeZone === "UTC") return new Date(naive);
  // Two passes settle the offset around daylight-saving switches.
  let instant = naive - zoneOffsetMs(naive, timeZone);
  instant = naive - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

function validDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function to24Hour(hour: number, meridiem: string | undefined) {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === "pm";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/** A Jira CSV date, or null when the value can't be read. */
export function parseJiraDate(
  raw: string,
  timeZone = "UTC",
): ParsedJiraDate | null {
  const value = raw.trim();
  if (!value) return null;

  const jira = JIRA_DATE.exec(value);
  if (jira) {
    const month = MONTHS.indexOf((jira[2] ?? "").slice(0, 3).toLowerCase());
    if (month < 0) return null;
    const shortYear = jira[3]?.length === 2;
    const year = Number(jira[3]) + (shortYear ? 2000 : 0);
    const day = Number(jira[1]);
    if (!validDay(year, month + 1, day)) return null;
    const hasTime = jira[4] !== undefined;
    const hour = hasTime ? to24Hour(Number(jira[4]), jira[7]) : 0;
    const minute = Number(jira[5] ?? 0);
    const second = Number(jira[6] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return {
      date: wallTimeToDate(
        { year, month: month + 1, day, hour, minute, second },
        timeZone,
      ),
      dateOnly: !hasTime,
    };
  }

  const iso = ISO_DATE.exec(value);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!validDay(year, month, day)) return null;
    const hasTime = iso[4] !== undefined;
    const offset = iso[7];
    if (offset) {
      const normalized =
        offset === "Z"
          ? "Z"
          : `${offset.slice(0, 3)}:${offset.slice(-2).padStart(2, "0")}`;
      const date = new Date(
        `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] ?? "00"}${normalized}`,
      );
      return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
    }
    const hour = Number(iso[4] ?? 0);
    const minute = Number(iso[5] ?? 0);
    const second = Number(iso[6] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return {
      date: wallTimeToDate(
        { year, month, day, hour, minute, second },
        timeZone,
      ),
      dateOnly: !hasTime,
    };
  }

  return null;
}
