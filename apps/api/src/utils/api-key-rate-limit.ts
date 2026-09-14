import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createRateLimiter,
  type RateLimitDecision,
  resetRateLimitMemory,
} from "./rate-limit";

// Per-key request limit for API-key callers (B13 K25), on the generic
// limiter. Counted in memory on each instance (documented: with N instances
// a key can make up to N times the limit). Sessions, cookies and MCP OAuth
// tokens are not limited here.

const DEFAULT_LIMIT_PER_MINUTE = 600;

/** The configured limit per minute; 0 (or an invalid value) disables it. */
export function apiKeyRateLimitPerMinute(): number {
  const raw = process.env.API_KEY_RATE_LIMIT_PER_MINUTE?.trim();
  if (raw === undefined || raw === "") return DEFAULT_LIMIT_PER_MINUTE;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

const apiKeyLimiter = createRateLimiter({
  name: "api-key",
  windowSeconds: 60,
  max: apiKeyRateLimitPerMinute,
  store: "memory",
});

/** Counts one request for the key, or null when limiting is disabled. */
export function consumeApiKeyRequest(keyId: string, now?: number) {
  return apiKeyLimiter.consume(keyId, now);
}

export function rateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(decision.reset),
  };
}

// The decision for a request, so the auth middleware can stamp the headers
// on whatever response the route produced, error responses included.
const decisions = new WeakMap<Request, RateLimitDecision>();

/**
 * Counts an API-key request. Over the limit it throws 429 with Retry-After;
 * otherwise the decision is remembered for `applyRateLimitHeaders`.
 */
export async function enforceApiKeyRateLimit(
  c: Context,
  keyId: string,
): Promise<void> {
  const decision = await consumeApiKeyRequest(keyId);
  if (!decision) return;
  if (!decision.allowed) {
    throw new HTTPException(429, {
      res: new Response("Rate limit exceeded", {
        status: 429,
        headers: {
          "content-type": "text/plain; charset=UTF-8",
          "Retry-After": String(decision.retryAfter),
          ...rateLimitHeaders(decision),
        },
      }),
    });
  }
  decisions.set(c.req.raw, decision);
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
    c.header(name, value);
  }
}

/** Puts the request's X-RateLimit-* headers on the final response. */
export function applyRateLimitHeaders(c: Context): void {
  const decision = decisions.get(c.req.raw);
  if (!decision) return;
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
    c.header(name, value);
  }
}

/** Test hook: forget every counted window. */
export function resetApiKeyRateLimits() {
  resetRateLimitMemory();
}
