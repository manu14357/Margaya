import i18n from "i18next";
import { durationParts, parseDurationInput } from "./duration";
import { type EstimateType, MAX_ESTIMATE_VALUE_LENGTH } from "./values";

export type Translate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

const defaultTranslate: Translate = (key, options) => i18n.t(key, options);

/** "1h 30m", "2h" or "45m" for a number of minutes. */
export function formatDuration(
  totalMinutes: number,
  t: Translate = defaultTranslate,
): string {
  const { hours, minutes } = durationParts(totalMinutes);
  if (hours > 0 && minutes > 0) {
    return t("tasks:estimate.duration.hoursMinutes", { hours, minutes });
  }
  if (hours > 0) return t("tasks:estimate.duration.hours", { hours });
  return t("tasks:estimate.duration.minutes", { minutes });
}

/** A sum shown with at most 2 decimals and no trailing zeros: 12.5, 3. */
export function formatEstimateNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * How an estimate value reads: time as a duration, points as the number
 * ("5", or "5 pts" with `withUnit`), categories as the category.
 */
export function formatEstimateValue(
  type: EstimateType,
  value: string | number,
  {
    withUnit = false,
    t = defaultTranslate,
  }: { withUnit?: boolean; t?: Translate } = {},
): string {
  if (type === "categories") return String(value);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (type === "time") return formatDuration(number, t);
  const text = formatEstimateNumber(number);
  return withUnit ? t("tasks:estimate.pointsValue", { value: text }) : text;
}

/** A stored value as the text to edit: time values become durations. */
export function toEstimateInput(
  type: EstimateType,
  value: string,
  t: Translate = defaultTranslate,
): string {
  return type === "time" ? formatEstimateValue(type, value, { t }) : value;
}

// Sent in place of a duration that can't be read, so validation reports it
// as not a number, the way the API would.
const UNREADABLE_DURATION = "unreadable";

/**
 * The value to validate and send for what was typed. Time systems store
 * minutes, so a duration is converted first; anything else goes as typed.
 */
export function fromEstimateInput(
  type: EstimateType,
  input: string,
  t: Translate = defaultTranslate,
): string {
  if (type !== "time") return input;
  const text = input.trim();
  if (text === "" || text.length > MAX_ESTIMATE_VALUE_LENGTH) return text;
  const minutes = parseDurationInput(text, {
    hour: t("tasks:estimate.duration.hourUnit"),
    minute: t("tasks:estimate.duration.minuteUnit"),
  });
  return minutes === null ? UNREADABLE_DURATION : String(minutes);
}
