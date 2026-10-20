import { HTTPException } from "hono/http-exception";

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

  constructor(
    code: AiErrorCode,
    message: string,
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(AI_ERROR_STATUS[code], {
      message,
      res: jsonResponse(code, message, options.retryAfterSeconds),
    });
    this.name = "AiError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** The body for an SSE `error` event. */
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}
