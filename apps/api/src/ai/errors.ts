import { HTTPException } from "hono/http-exception";
import { createRedactor } from "./redact";

// AI failures carry a stable code the web maps to a translated message
// (`ai:errors.<code>`); provider text never reaches the client. An AiError
// is an HTTPException, so routes may simply let it propagate: the response
// is JSON `{ code, message }`, like REAUTH_REQUIRED.

export const AI_ERROR_STATUS = {
  /** The instance, workspace or project has AI off. */
  AI_DISABLED: 403,
  /** No usable provider: no key, no base URL or no model. */
  AI_NOT_CONFIGURED: 409,
  /** The data in context may not go to any allowed provider (ai/router.ts). */
  AI_ROUTE_BLOCKED: 403,
  /** The workspace's monthly or the user's daily cap is reached. */
  AI_BUDGET_EXCEEDED: 429,
  /** Too many concurrent streams or requests. */
  AI_RATE_LIMITED: 429,
  /** The provider declined the request. */
  AI_REFUSED: 422,
  /** The provider failed or timed out. */
  AI_PROVIDER_ERROR: 502,
} as const;

export type AiErrorCode = keyof typeof AI_ERROR_STATUS;

function jsonResponse(
  code: AiErrorCode,
  message: string,
  retryAfterSeconds?: number,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (retryAfterSeconds) headers["retry-after"] = String(retryAfterSeconds);
  return new Response(JSON.stringify({ code, message }), {
    status: AI_ERROR_STATUS[code],
    headers,
  });
}

export class AiError extends HTTPException {
  readonly code: AiErrorCode;
  readonly retryAfterSeconds?: number;
  /**
   * What the provider said, shortened and scrubbed (providerErrorDetail):
   * for the server log and the run history, never the error response.
   */
  readonly detail?: string;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; detail?: string } = {},
  ) {
    super(AI_ERROR_STATUS[code], {
      message,
      res: jsonResponse(code, message, options.retryAfterSeconds),
    });
    this.name = "AiError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
  }

  /** The body for an SSE `error` event. */
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

const MAX_DETAIL = 300;

/** The readable part of a provider's error body (JSON or plain text). */
function errorBodyText(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const record = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const root = record(parsed);
    const nested = record(root?.error);
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const message =
      text(nested?.message) ||
      text(root?.message) ||
      text(root?.error) ||
      text(root?.detail);
    const kind = text(nested?.code) || text(nested?.type) || text(root?.type);
    if (message || kind) {
      return kind && !message.includes(kind)
        ? `${message}${message ? " " : ""}(${kind})`
        : message;
    }
  } catch {}
  return body.replace(/<[^>]*>/g, " ");
}

/**
 * A short, safe excerpt of a provider's error answer for the server log
 * and a failed run's history. Servers that echo the request in validation
 * errors do so after an "input" field, so the excerpt stops there; tokens,
 * emails and other credential-like values are replaced, and it is capped.
 */
export function providerErrorDetail(status: number | null, body: string) {
  let text = errorBodyText(body);
  const echo = text.search(/["']input["']\s*:/i);
  if (echo !== -1) text = `${text.slice(0, echo)}…`;
  text = createRedactor().redact(text.replace(/\s+/g, " ").trim());
  if (text.length > MAX_DETAIL) text = `${text.slice(0, MAX_DETAIL - 1)}…`;
  const prefix = status === null ? "" : `HTTP ${status}`;
  return [prefix, text].filter(Boolean).join(": ");
}

/**
 * A provider account out of credit or over its paid quota. Some providers
 * answer 402; others 400, 403 or 429 with a billing message, which must not
 * read as "rate limited" or "unreachable".
 */
export function isBillingFailure(status: number, body: string): boolean {
  if (status === 402) return true;
  if (![400, 403, 429].includes(status)) return false;
  return /insufficient[_ ]quota|exceeded your current quota|credit balance|out of credits?|insufficient (?:credits?|balance|funds)|billing|payment required/i.test(
    body,
  );
}

export const BILLING_MESSAGE =
  "The AI provider account is out of credit or over its quota. Check the provider's billing";
