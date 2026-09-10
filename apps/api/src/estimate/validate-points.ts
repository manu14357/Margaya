import type { EstimateType } from "./types";

// Pure validation and canonical forms of estimate values. The web mirrors
// these rules for live feedback; the API stays authoritative.

export const MIN_ESTIMATE_POINTS = 2;
export const MAX_ESTIMATE_POINTS = 10;
export const MAX_ESTIMATE_VALUE_LENGTH = 20;
export const MAX_ESTIMATE_NAME_LENGTH = 60;
export const MAX_POINTS_VALUE = 999;
/** Time values are whole minutes: at most 1000 hours. */
export const MAX_TIME_MINUTES = 60_000;
const MAX_POINTS_DECIMALS = 2;

export type ValueErrorCode =
  | "empty"
  | "too_long"
  | "not_numeric"
  | "numeric_category"
  | "not_positive"
  | "too_large"
  | "too_precise"
  | "duplicate";

export type CountErrorCode = "too_few" | "too_many";

/**
 * One validation error. `index` is the offending value's position in the
 * submitted list, or -1 for the count rules, which concern the whole list.
 */
export type EstimateValueError = {
  index: number;
  code: ValueErrorCode | CountErrorCode;
};

export type CanonicalValue = {
  /** Display text: the shortest decimal, whole minutes, or a category. */
  value: string;
  /** The number for points and time; null for categories. */
  numericValue: number | null;
};

type SingleResult =
  | { ok: true; point: CanonicalValue }
  | { ok: false; code: ValueErrorCode };

// A plain decimal, optionally signed. Exponents, commas and hex are not
// numbers here, so "1,5" and "1e3" are rejected as points and allowed as
// categories.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Digits after the decimal point, ignoring trailing zeros ("2.50" has 1). */
function decimalPlaces(text: string): number {
  const fraction = text.split(".")[1];
  return fraction ? fraction.replace(/0+$/, "").length : 0;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** Canonical form of one value, or the first rule it breaks. */
export function canonicalizeEstimateValue(
  type: EstimateType,
  raw: string,
): SingleResult {
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
export function estimateValueKey(point: CanonicalValue): string {
  return point.numericValue === null
    ? point.value.toLowerCase()
    : String(point.numericValue);
}

export type ValidatedValues =
  | { ok: true; points: CanonicalValue[] }
  | { ok: false; errors: EstimateValueError[] };

/**
 * Validates a whole list of values (a new system). Every value is checked;
 * a later copy of an earlier value is the duplicate. The count rule applies
 * to the list as submitted.
 */
export function validateEstimateValues(
  type: EstimateType,
  values: readonly string[],
): ValidatedValues {
  const errors: EstimateValueError[] = [];
  const points: CanonicalValue[] = [];
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
    points.push(result.point);
  });

  if (values.length < MIN_ESTIMATE_POINTS) {
    errors.push({ index: -1, code: "too_few" });
  } else if (values.length > MAX_ESTIMATE_POINTS) {
    errors.push({ index: -1, code: "too_many" });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, points };
}

/**
 * Validates one value against the other values of its system (adding or
 * editing a point). Errors use index 0, the single submitted value.
 */
export function validateEstimateValue(
  type: EstimateType,
  raw: string,
  others: readonly CanonicalValue[],
):
  | { ok: true; point: CanonicalValue }
  | { ok: false; error: EstimateValueError } {
  const result = canonicalizeEstimateValue(type, raw);
  if (!result.ok) {
    return { ok: false, error: { index: 0, code: result.code } };
  }
  const key = estimateValueKey(result.point);
  if (others.some((other) => estimateValueKey(other) === key)) {
    return { ok: false, error: { index: 0, code: "duplicate" } };
  }
  return result;
}
