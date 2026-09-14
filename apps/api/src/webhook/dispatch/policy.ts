import { createHmac } from "node:crypto";

// Pure delivery rules (B13a §3.5): how one attempt is classified, when the
// next one runs, when a webhook is disabled, and how a body is signed.

export type AttemptOutcome =
  | { kind: "response"; status: number; retryAfter?: string | null }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "destination" }
  | { kind: "secret" };

export type AttemptResult = "succeeded" | "retry" | "failed";

export const ATTEMPT_ERRORS = {
  redirect: "Redirects are not followed",
  timeout: "Timed out after 10 seconds",
  network: "Connection failed",
  destination: "Destination not allowed",
  secret: "Signing secret unavailable",
} as const;

/** The result of one attempt and the safe error stored with it. */
export function classifyAttempt(outcome: AttemptOutcome): {
  result: AttemptResult;
  error: string | null;
} {
  switch (outcome.kind) {
    case "response": {
      const { status } = outcome;
      if (status >= 200 && status < 300) {
        return { result: "succeeded", error: null };
      }
      if (status >= 300 && status < 400) {
        return { result: "failed", error: ATTEMPT_ERRORS.redirect };
      }
      if (status === 408 || status === 429 || status >= 500) {
        return { result: "retry", error: null };
      }
      return { result: "failed", error: null };
    }
    case "timeout":
      return { result: "retry", error: ATTEMPT_ERRORS.timeout };
    case "network":
      return { result: "retry", error: ATTEMPT_ERRORS.network };
    case "destination":
      // DNS can be transient, so a blocked destination is retried.
      return { result: "retry", error: ATTEMPT_ERRORS.destination };
    case "secret":
      return { result: "failed", error: ATTEMPT_ERRORS.secret };
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Delay after failed attempt n (1-based); attempt 6 is the last. */
export const RETRY_SCHEDULE_MS = [
  MINUTE,
  5 * MINUTE,
  30 * MINUTE,
  2 * HOUR,
  6 * HOUR,
] as const;

export const MAX_RETRY_AFTER_MS = 6 * HOUR;

/**
 * Seconds from a Retry-After header (delta seconds or an HTTP date), or
 * null when absent or unreadable.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: Date,
): number | null {
  const raw = header?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/**
 * Milliseconds until the next attempt after failed attempt `attempt`: the
 * schedule with ±10% jitter, or a longer Retry-After (capped at 6 hours).
 */
export function nextDelay(
  attempt: number,
  retryAfterSeconds: number | null,
  random: () => number = Math.random,
): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_SCHEDULE_MS.length) - 1;
  const base = RETRY_SCHEDULE_MS[index] ?? MINUTE;
  const jittered = Math.round(base * (0.9 + 0.2 * random()));
  if (retryAfterSeconds === null) return jittered;
  const requested = Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  return Math.max(jittered, requested);
}

export const AUTO_DISABLE_STREAK = 5;
export const AUTO_DISABLE_AFTER_MS = 24 * HOUR;

/**
 * At least 5 deliveries in a row failed for good, the first of them at
 * least 24 hours ago, with no success since.
 */
export function shouldAutoDisable(
  failureStreak: number,
  failingSince: Date | null,
  now: Date,
): boolean {
  return (
    failureStreak >= AUTO_DISABLE_STREAK &&
    failingSince !== null &&
    failingSince.getTime() <= now.getTime() - AUTO_DISABLE_AFTER_MS
  );
}

/** Hex HMAC-SHA256 over "timestamp.body". */
export function signBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

/** The X-Margaya-Signature-256 value: the current secret's entry first. */
export function signatureHeader(
  secrets: readonly string[],
  timestamp: string,
  body: string,
): string {
  return secrets
    .map((secret) => `v1=${signBody(secret, timestamp, body)}`)
    .join(",");
}
