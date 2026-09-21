/** How to read slash dates: detect from the values, or a fixed order. */
export type ImportDateFormat = "auto" | "mdy" | "dmy";
type DateOrder = "mdy" | "dmy";

const ISO_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** Local midnight of a calendar day, or null when the day doesn't exist. */
function localDay(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * The order the slash dates of a file use: day-first when some first part
 * is above 12, month-first when some second part is, else null (ambiguous
 * or contradictory, so the user picks it).
 */
export function detectDateOrder(values: Iterable<string>): DateOrder | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const match = SLASH_DATE.exec(value.trim());
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst === monthFirst) return null;
  return dayFirst ? "dmy" : "mdy";
}

/**
 * An ISO date-time for one CSV cell, or null when it can't be read. Calendar
 * days become local midnight, like the due-date picker. `order` null means
 * auto with no file-wide answer: only self-evident slash dates are read.
 */
export function parseImportDate(
  raw: string,
  order: DateOrder | null,
): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = ISO_DATE.exec(value);
  if (iso) {
    return (
      localDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))?.toISOString() ??
      null
    );
  }

  if (ISO_DATE_TIME.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const slash = SLASH_DATE.exec(value);
  if (!slash) return null;
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  const year = Number(slash[3]);
  const effective =
    order ??
    (first > 12 && second <= 12
      ? "dmy"
      : second > 12 && first <= 12
        ? "mdy"
        : null);
  if (!effective) return null;
  const [month, day] = effective === "mdy" ? [first, second] : [second, first];
  return localDay(year, month, day)?.toISOString() ?? null;
}

export function resolveDateOrder(
  format: ImportDateFormat,
  values: Iterable<string>,
): DateOrder | null {
  return format === "auto" ? detectDateOrder(values) : format;
}
