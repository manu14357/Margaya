// The single gate every audit metadata value passes before it is stored.
// Secrets (webhook signing secrets, API key values, OAuth and session tokens,
// passwords, SMTP and channel credentials, incoming-webhook URLs that embed a
// token) are replaced by REDACTED; long or deep values are bounded.

export const REDACTED = "[redacted]";

const MAX_STRING = 500;
const MAX_ARRAY = 50;
const MAX_KEYS = 50;
const MAX_DEPTH = 5;

// Matched against object keys, case-insensitively, after dropping "-" and "_".
const SENSITIVE_KEY =
  /(secret|token|password|passwd|smtppass|^pass$|passphrase|credential|apikey|privatekey|authorization|cookie|signature|ciphertext|webhookurl|hookurl|^otp|otp$|hash$|^key$|^session$)/;

// Keys that name an identifier, not a value (apiKeyId, sessionId, tokenId…).
const IDENTIFIER_KEY = /(id|ids)$/;

// Values that look like credentials whatever key they sit under.
const SENSITIVE_VALUE =
  /^(bearer\s|basic\s|whsec_|margaya_|xox[abprs]-|gh[pousr]_|github_pat_|glpat-|sk-|sk_live_|pk_live_|eyJ[A-Za-z0-9_-]{10,}\.)/i;

function normalizeKey(key: string) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

/** True when a value under this key must never be stored. */
export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (IDENTIFIER_KEY.test(normalized)) return false;
  return SENSITIVE_KEY.test(normalized);
}

/** Strips credentials, query and fragment from a URL; keeps it readable. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : "/…"}`;
  } catch {
    return REDACTED;
  }
}

function redactString(value: string): string {
  if (SENSITIVE_VALUE.test(value.trim())) return REDACTED;
  // A URL carrying userinfo would leak it; keep only its origin.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(value)) return redactUrl(value);
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

/**
 * A deep copy of `value` with secrets replaced by REDACTED and sizes
 * bounded. Dates become ISO strings; functions and symbols are dropped.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return null;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
    if (item === undefined || typeof item === "function") continue;
    out[key] = isSensitiveKey(key)
      ? item === null || item === ""
        ? item
        : REDACTED
      : redact(item, depth + 1);
  }
  return out;
}

/** `redact` for a metadata object; null when there is nothing to keep. */
export function redactMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out = redact(metadata) as Record<string, unknown>;
  return Object.keys(out).length > 0 ? out : null;
}

export type FieldChange = { before: unknown; after: unknown } | typeof REDACTED;

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The fields whose values differ between two snapshots, as before/after
 * pairs. A sensitive field reports only that it changed (REDACTED).
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const key of keys) {
    const was = before?.[key];
    const now = after?.[key];
    if (same(was, now)) continue;
    changes[key] = isSensitiveKey(key)
      ? REDACTED
      : {
          before: redact(was ?? null),
          after: redact(now ?? null),
        };
  }
  return changes;
}
