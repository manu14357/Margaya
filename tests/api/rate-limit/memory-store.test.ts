import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  configured: false,
  incr: vi.fn(async (_key: string): Promise<number> => 1),
  expire: vi.fn(async () => 1),
}));

vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => redis.configured,
  getRedisPub: () => ({ incr: redis.incr, expire: redis.expire }),
}));

const {
  createRateLimiter,
  enforceRateLimits,
  MEMORY_STORE_MAX_KEYS,
  rateLimitMemorySize,
  resetRateLimitMemory,
} = await import("../../../apps/api/src/utils/rate-limit");

const minute = 1_700_000_040_000; // a multiple of 60 s

beforeEach(() => {
  resetRateLimitMemory();
  redis.configured = false;
  redis.incr.mockReset().mockResolvedValue(1);
  redis.expire.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generic rate limiter", () => {
  it("counts per window and rolls over with the next one", async () => {
    const limiter = createRateLimiter({
      name: "test",
      windowSeconds: 60,
      max: 2,
    });

    const results = [
      await limiter.consume("ip-1", minute),
      await limiter.consume("ip-1", minute + 10_000),
      await limiter.consume("ip-1", minute + 45_500),
    ];
    expect(results.map((r) => r?.allowed)).toEqual([true, true, false]);
    expect(results[2]?.retryAfter).toBe(15);
    expect(results[2]?.reset).toBe((minute + 60_000) / 1000);
    expect((await limiter.consume("ip-1", minute + 60_000))?.allowed).toBe(
      true,
    );
  });

  it("keeps subjects and limiters apart", async () => {
    const comments = createRateLimiter({
      name: "c",
      windowSeconds: 60,
      max: 1,
    });
    const votes = createRateLimiter({ name: "v", windowSeconds: 60, max: 1 });

    expect((await comments.consume("u1", minute))?.allowed).toBe(true);
    expect((await comments.consume("u2", minute))?.allowed).toBe(true);
    expect((await votes.consume("u1", minute))?.allowed).toBe(true);
    expect((await comments.consume("u1", minute))?.allowed).toBe(false);
  });

  it("is disabled at max 0", async () => {
    const limiter = createRateLimiter({
      name: "off",
      windowSeconds: 60,
      max: () => 0,
    });
    expect(await limiter.consume("u1", minute)).toBeNull();
  });

  it("caps the memory store, dropping the oldest windows first", async () => {
    const limiter = createRateLimiter({
      name: "cap",
      windowSeconds: 3600,
      max: 5,
    });
    for (let index = 0; index < MEMORY_STORE_MAX_KEYS + 10; index += 1) {
      await limiter.consume(`ip-${index}`, minute);
    }
    expect(rateLimitMemorySize()).toBe(MEMORY_STORE_MAX_KEYS);
  });

  it("counts in Redis when configured, and falls back to memory when it fails", async () => {
    redis.configured = true;
    const limiter = createRateLimiter({
      name: "shared",
      windowSeconds: 60,
      max: 3,
    });

    redis.incr.mockResolvedValueOnce(4);
    expect((await limiter.consume("u1", minute))?.allowed).toBe(false);
    expect(redis.incr).toHaveBeenCalledWith(`margaya:rl:shared:u1:${minute}`);

    vi.spyOn(console, "error").mockImplementation(() => {});
    redis.incr.mockRejectedValue(new Error("connection refused"));
    const fallback = await limiter.consume("u1", minute);
    expect(fallback).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("throws the friendly 429 for the first limit that is exceeded", async () => {
    const tight = createRateLimiter({ name: "t", windowSeconds: 60, max: 1 });
    await enforceRateLimits([[tight, "u1"]]);

    const error = await enforceRateLimits([
      [tight, null],
      [tight, "u1"],
    ]).catch((caught: unknown) => caught);
    const response = (error as { getResponse(): Response }).getResponse();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await response.text()).toMatch(
      /^You're doing that too often\. Try again in \d+ seconds\.$/,
    );
  });
});
