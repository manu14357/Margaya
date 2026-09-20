import { i18n } from "./i18n";

type DateInput = Date | string | number;

function toDate(input: DateInput) {
  return input instanceof Date ? input : new Date(input);
}

function getLocale(locale?: string) {
  return locale || i18n.resolvedLanguage || i18n.language || "en-US";
}

// Building an Intl formatter costs far more than using one: a 5,000-task
// calendar or gantt spent ~10 s constructing them, one per label. Formatters
// are immutable, so one per locale and options is reused.
const formatterCache = new Map<string, unknown>();

function cachedFormatter<T>(
  kind: string,
  locale: string,
  options: object | undefined,
  create: () => T,
): T {
  const key = `${kind}\u0000${locale}\u0000${options ? JSON.stringify(options) : ""}`;
  const cached = formatterCache.get(key);
  if (cached) return cached as T;
  const formatter = create();
  formatterCache.set(key, formatter);
  return formatter;
}

function dateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions) {
  return cachedFormatter(
    "date",
    locale,
    options,
    () => new Intl.DateTimeFormat(locale, options),
  );
}

export function formatDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  return dateTimeFormat(getLocale(locale), options).format(toDate(value));
}

export function formatDateShort(value: DateInput, locale?: string) {
  return formatDate(
    value,
    {
      month: "short",
      day: "numeric",
    },
    locale,
  );
}

export function formatDateMedium(value: DateInput, locale?: string) {
  return formatDate(
    value,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
    locale,
  );
}

/** Locale-aware number with grouping, e.g. chart values and axis ticks. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 },
  locale?: string,
) {
  const resolved = getLocale(locale);
  return cachedFormatter(
    "number",
    resolved,
    options,
    () => new Intl.NumberFormat(resolved, options),
  ).format(value);
}

/** Locale-aware full date and time (for tooltips next to relative labels like "yesterday"). */
export function formatDateTime(value: DateInput, locale?: string) {
  return formatDate(
    value,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
    locale,
  );
}

export function formatRelativeTime(
  value: DateInput,
  locale?: string,
  now = new Date(),
) {
  const target = toDate(value);
  const diffMs = target.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  const resolved = getLocale(locale);
  const formatter = cachedFormatter(
    "relative",
    resolved,
    undefined,
    () => new Intl.RelativeTimeFormat(resolved, { numeric: "auto" }),
  );

  for (const [unit, unitSeconds] of units) {
    if (absSeconds >= unitSeconds || unit === "second") {
      return formatter.format(Math.round(diffSeconds / unitSeconds), unit);
    }
  }

  return formatter.format(0, "second");
}
