import { HTTPException } from "hono/http-exception";
import { getRedisPub, isRedisConfigured } from "../redis";

// A small generic fixed-window rate limiter (B12 §3.10, also used for API
// keys, B13 K25). The counter key is the limiter name, the subject (a user
// id, an IP, a project id or a key id) and the window start.
//
// Stores: memory always works (counts are per API process, so N instances
// without Redis allow up to N times the limit). With Redis configured,
// limiters that opt in count in Redis across instances; any Redis error
// falls back to the memory count (fail open to the local limit).

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the current window ends. */
  reset: number;
  /** Seconds until the window ends (Retry-After). */
  retryAfter: number;
};

export type RateLimiter = {
  name: string;
  /** Counts one request; null when the limiter is disabled (max 0). */
  consume(subject: string, now?: number): Promise<RateLimitDecision | null>;
};

type LimiterOptions = {
  name: string;
  windowSeconds: number;
  /** A fixed limit, or a function read on every call (0 disables). */
  max: number | (() => number);
  /** "auto" uses Redis when configured; "memory" never does. */
  store?: "auto" | "memory";
};

export const MEMORY_STORE_MAX_KEYS = 100_000;
const SWEEP_INTERVAL_MS = 60_000;
const REDIS_PREFIX = "margaya:rl:";

type MemoryEntry = { count: number; expiresAt: number };

const memory = new Map<string, MemoryEntry>();
let lastSweep = 0;

function sweep(now: number) {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
  lastSweep = now;
}

function memoryIncrement(key: string, expiresAt: number, now: number): number {
  if (now - lastSweep >= SWEEP_INTERVAL_MS) sweep(now);
  const entry = memory.get(key);
  if (entry && entry.expiresAt > now) {
    entry.count += 1;
    return entry.count;
  }
  if (entry) memory.delete(key);
  if (memory.size >= MEMORY_STORE_MAX_KEYS) {
    sweep(now);
    // Still full: drop the oldest windows first (Map keeps insertion order).
    for (const oldest of memory.keys()) {
      if (memory.size < MEMORY_STORE_MAX_KEYS) break;
      memory.delete(oldest);
    }
  }
  memory.set(key, { count: 1, expiresAt });
  return 1;
}

async function redisIncrement(key: string, ttlSeconds: number) {
  const client = getRedisPub();
  const count = await client.incr(`${REDIS_PREFIX}${key}`);
  if (count === 1) await client.expire(`${REDIS_PREFIX}${key}`, ttlSeconds);
  return count;
}

export function createRateLimiter({
  name,
  windowSeconds,
  max,
  store = "auto",
}: LimiterOptions): RateLimiter {
  const windowMs = windowSeconds * 1000;
  const limitOf = typeof max === "function" ? max : () => max;

  return {
    name,
    async consume(subject, now = Date.now()) {
      const limit = limitOf();
      if (!(limit > 0)) return null;

      const start = now - (now % windowMs);
      const end = start + windowMs;
      const key = `${name}:${subject}:${start}`;

      let count: number;
      if (store === "auto" && isRedisConfigured()) {
        try {
          count = await redisIncrement(key, windowSeconds + 1);
        } catch (error) {
          console.error(`Rate limiter ${name}: Redis unavailable`, {
            error: error instanceof Error ? error.message : String(error),
          });
          count = memoryIncrement(key, end, now);
        }
      } else {
        count = memoryIncrement(key, end, now);
      }

      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        reset: Math.ceil(end / 1000),
        retryAfter: Math.max(1, Math.ceil((end - now) / 1000)),
      };
    },
  };
}

/** The 429 the public routes answer, with Retry-After. */
export function tooOftenError(decision: RateLimitDecision): HTTPException {
  return new HTTPException(429, {
    res: new Response(
      `You're doing that too often. Try again in ${decision.retryAfter} seconds.`,
      {
        status: 429,
        headers: {
          "content-type": "text/plain; charset=UTF-8",
          "Retry-After": String(decision.retryAfter),
        },
      },
    ),
  });
}

/**
 * Counts every (limiter, subject) pair and throws the 429 of the first one
 * over its limit. Pairs with a null subject are skipped.
 */
export async function enforceRateLimits(
  checks: ReadonlyArray<[RateLimiter, string | null]>,
): Promise<void> {
  for (const [limiter, subject] of checks) {
    if (subject === null) continue;
    const decision = await limiter.consume(subject);
    if (decision && !decision.allowed) throw tooOftenError(decision);
  }
}

/** Test hooks for the memory store. */
export function resetRateLimitMemory() {
  memory.clear();
  lastSweep = 0;
}

export function rateLimitMemorySize() {
  return memory.size;
}
