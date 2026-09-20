// Estimate value rules, mirrored from the API (estimate/validate-points) for
// live feedback while typing. The API stays authoritative: it runs the same
// checks and answers 400 with the same error codes.

export const ESTIMATE_TYPES = ["points", "categories", "time"] as const;

export type EstimateType = (typeof ESTIMATE_TYPES)[number];

export const MIN_ESTIMATE_POINTS = 2;
export const MAX_ESTIMATE_POINTS = 10;
export const MAX_ESTIMATE_VALUE_LENGTH = 20;
export const MAX_ESTIMATE_NAME_LENGTH = 60;
export const MAX_POINTS_VALUE = 999;
/** Time values are whole minutes: at most 1000 hours. */
export const MAX_TIME_MINUTES = 60_000;
const MAX_POINTS_DECIMALS = 2;

export type EstimateValueErrorCode =
  | "empty"
  | "too_long"
  | "not_numeric"
  | "numeric_category"
  | "not_positive"
  | "too_large"
  | "too_precise"
  | "duplicate";

export type EstimateCountErrorCode = "too_few" | "too_many";

export type EstimateErrorCode = EstimateValueErrorCode | EstimateCountErrorCode;

/** `index` is the value's position in the list, or -1 for the count rules. */
export type EstimateValueError = { index: number; code: EstimateErrorCode };

export type CanonicalEstimateValue = {
  /** Display text: the shortest decimal, whole minutes, or a category. */
  value: string;
  /** The number for points and time; null for categories. */
  numericValue: number | null;
};

export function isEstimateType(value: unknown): value is EstimateType {
  return (ESTIMATE_TYPES as readonly unknown[]).includes(value);
}

/** Points and time can be summed; categories can't. */
export function isNumericEstimateType(type: EstimateType): boolean {
  return type === "points" || type === "time";
}

// A plain decimal, optionally signed. Exponents, commas and hex are not
// numbers here, so "1,5" and "1e3" fail as points and pass as categories.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Digits after the decimal point, ignoring trailing zeros ("2.50" has 1). */
function decimalPlaces(text: string): number {
  const fraction = text.split(".")[1];
  return fraction ? fraction.replace(/0+$/, "").length : 0;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

export type CanonicalResult =
  | { ok: true; point: CanonicalEstimateValue }
  | { ok: false; code: EstimateValueErrorCode };

/** The canonical form of one value, or the first rule it breaks. */
export function canonicalizeEstimateValue(
  type: EstimateType,
  raw: string,
): CanonicalResult {
  const text = raw.trim();
  if (text === "") return { ok: false, code: "empty" };
  if (text.length > MAX_ESTIMATE_VALUE_LENGTH) {
    return { ok: false, code: "too_long" };
  }

  const isNumber = DECIMAL_PATTERN.test(text);
  if (type === "categories") {
    if (isNumber) return { ok: false, code: "numeric_category" };
    return {
      ok: true,
      point: { value: collapseWhitespace(text), numericValue: null },
    };
  }

  if (!isNumber) return { ok: false, code: "not_numeric" };
  const number = Number(text);
  if (!Number.isFinite(number)) return { ok: false, code: "not_numeric" };
  if (number <= 0) return { ok: false, code: "not_positive" };

  if (type === "time") {
    if (number > MAX_TIME_MINUTES) return { ok: false, code: "too_large" };
    if (!Number.isInteger(number)) return { ok: false, code: "too_precise" };
    return { ok: true, point: { value: String(number), numericValue: number } };
  }

  if (number > MAX_POINTS_VALUE) return { ok: false, code: "too_large" };
  if (decimalPlaces(text) > MAX_POINTS_DECIMALS) {
    return { ok: false, code: "too_precise" };
  }
  // String(number) is the shortest text that round-trips: 5, 2.5, 0.25.
  return { ok: true, point: { value: String(number), numericValue: number } };
}

/**
 * The key two values collide on: numeric equality for points and time
 * ("5" and "5.0"), case-insensitive text for categories ("m" and "M").
 */
export function estimateValueKey(point: CanonicalEstimateValue): string {
  return point.numericValue === null
    ? point.value.toLowerCase()
    : String(point.numericValue);
}

/**
 * Checks a whole list of values (a new system). Every value is checked; a
 * later copy of an earlier value is the duplicate. The count rule applies to
 * the list as given.
 */
export function validateEstimateValues(
  type: EstimateType,
  values: readonly string[],
): { ok: boolean; errors: EstimateValueError[] } {
  const errors: EstimateValueError[] = [];
  const seen = new Set<string>();

  values.forEach((raw, index) => {
    const result = canonicalizeEstimateValue(type, raw);
    if (!result.ok) {
      errors.push({ index, code: result.code });
      return;
    }
    const key = estimateValueKey(result.point);
    if (seen.has(key)) {
      errors.push({ index, code: "duplicate" });
      return;
    }
    seen.add(key);
  });

  if (values.length < MIN_ESTIMATE_POINTS) {
    errors.push({ index: -1, code: "too_few" });
  } else if (values.length > MAX_ESTIMATE_POINTS) {
    errors.push({ index: -1, code: "too_many" });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Checks one value against the other values of its system, as adding or
 * editing a point does.
 */
export function validateEstimateValue(
  type: EstimateType,
  raw: string,
  others: readonly CanonicalEstimateValue[],
): CanonicalResult {
  const result = canonicalizeEstimateValue(type, raw);
  if (!result.ok) return result;
  const key = estimateValueKey(result.point);
  if (others.some((other) => estimateValueKey(other) === key)) {
    return { ok: false, code: "duplicate" };
  }
  return result;
}

/**
 * The order a system's points end up in, positions renumbered 1..n: points
 * and time ascending by value, categories as given.
 */
export function sortPointsForType<T extends { numericValue: number | null }>(
  type: EstimateType,
  points: readonly T[],
): Array<T & { position: number }> {
  const ordered = isNumericEstimateType(type)
    ? [...points].sort((a, b) => (a.numericValue ?? 0) - (b.numericValue ?? 0))
    : [...points];
  return ordered.map((point, index) => ({ ...point, position: index + 1 }));
}
