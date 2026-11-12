// A small iCalendar (RFC 5545) writer for read-only subscription feeds.
// Pure: no database, no clock. Lines end in CRLF and are folded at 75
// octets (3.1); TEXT values are escaped (3.3.11).

export type IcsEvent = {
  uid: string;
  /** Inclusive first day, "YYYY-MM-DD". */
  startDate: string;
  /** Exclusive end day, "YYYY-MM-DD" (the day after the last day). */
  endDate: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string[];
  /** Feeds carry no METHOD, so DTSTAMP equals LAST-MODIFIED (3.8.7.2). */
  lastModified: Date;
  sequence: number;
};

export type IcsCalendar = {
  name: string;
  /** IANA zone the all-day dates were computed in (X-WR-TIMEZONE). */
  timezone: string;
  events: IcsEvent[];
};

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
/**
 * Drops the control characters a value may not hold (3.1): all but HTAB.
 * Line breaks are kept for the caller to escape or remove.
 */
function stripControls(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    const control = code < 0x20 || code === 0x7f;
    if (!control || char === "\t" || char === "\n" || char === "\r") {
      out += char;
    }
  }
  return out;
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return stripControls(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line so no physical line exceeds 75 octets, counting
 * UTF-8 bytes and never splitting a character. Continuation lines start
 * with one space, which counts toward their 75.
 */
export function foldLine(line: string): string {
  let out = "";
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0) ?? 0);
    const limit = out === "" ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      out += `${current}${CRLF} `;
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  return out + current;
}

/** "YYYY-MM-DD" → "YYYYMMDD" (a DATE value). */
export function formatDate(date: string): string {
  return date.replaceAll("-", "");
}

/** A UTC DATE-TIME value: "YYYYMMDDTHHMMSSZ". */
export function formatUtcDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/** A URI value: no escaping, but no line breaks or controls either. */
function cleanUri(value: string): string {
  return stripControls(value).replace(/[\r\n]/g, "");
}

function eventLines(event: IcsEvent): string[] {
  const stamp = formatUtcDateTime(event.lastModified);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${Math.max(0, Math.trunc(event.sequence))}`,
    `DTSTART;VALUE=DATE:${formatDate(event.startDate)}`,
    `DTEND;VALUE=DATE:${formatDate(event.endDate)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  if (event.url) lines.push(`URL:${cleanUri(event.url)}`);
  if (event.categories?.length) {
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
  }
  // A task is a deadline, not a meeting: it never blocks free/busy time.
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/** The whole VCALENDAR object, CRLF-terminated and folded. */
export function buildCalendar(calendar: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Margaya//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    `X-WR-TIMEZONE:${escapeText(calendar.timezone)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...calendar.events.flatMap(eventLines),
    "END:VCALENDAR",
  ];
  return lines.map((line) => foldLine(line) + CRLF).join("");
}
