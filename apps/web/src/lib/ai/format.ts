import { HttpError } from "@/lib/http-error";

// Formatting and error helpers shared by AI screens.

export const AI_ERROR_CODES = [
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_ROUTE_BLOCKED",
  "AI_BUDGET_EXCEEDED",
  "AI_RATE_LIMITED",
  "AI_REFUSED",
  "AI_PROVIDER_ERROR",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** The AI error code of a failed request, if it carries one. */
export function aiErrorCode(error: unknown): AiErrorCode | null {
  const raw =
    error instanceof HttpError
      ? error.message
      : typeof error === "object" && error && "code" in error
        ? JSON.stringify(error)
        : null;
  if (!raw) return null;
  try {
    const code = (JSON.parse(raw) as { code?: unknown }).code;
    return (AI_ERROR_CODES as readonly string[]).includes(code as string)
      ? (code as AiErrorCode)
      : null;
  } catch {
    return null;
  }
}

/** The static i18n key for an AI failure (falls back to a generic one). */
export function aiErrorKey(error: unknown): `ai:errors.${string}` {
  const code = aiErrorCode(error);
  return code ? `ai:errors.${code}` : "ai:errors.unknown";
}

/** Micro-dollars as money, e.g. 1_234_567 → "$1.23" (cents below $1000). */
export function formatCostMicros(micros: number, locale?: string): string {
  const dollars = micros / 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars > 0 && dollars < 0.01 ? 4 : 2,
    maximumFractionDigits: dollars > 0 && dollars < 0.01 ? 4 : 2,
  }).format(dollars);
}

export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const USAGE_RANGES = ["thisMonth", "last30Days", "last90Days"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const USAGE_RANGE_KEYS = {
  thisMonth: "ai:usage.range.thisMonth",
  last30Days: "ai:usage.range.last30Days",
  last90Days: "ai:usage.range.last90Days",
} as const satisfies Record<UsageRange, string>;

/** Inclusive UTC days for a named range. */
export function usageRangeDays(
  range: UsageRange,
  now = new Date(),
): { from: string; to: string } {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (range === "thisMonth") {
    return {
      from: isoDay(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      ),
      to: isoDay(today),
    };
  }
  const days = range === "last30Days" ? 30 : 90;
  return {
    from: isoDay(new Date(today.getTime() - (days - 1) * 86_400_000)),
    to: isoDay(today),
  };
}

/** Dollars typed in a field → micro-dollars; "" → null; invalid → NaN. */
export function dollarsToMicros(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dollars = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(dollars) || dollars < 0) return Number.NaN;
  return Math.round(dollars * 1_000_000);
}

export function microsToDollarsInput(micros: number | null): string {
  if (micros === null) return "";
  return String(Math.round(micros / 10_000) / 100);
}
