import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeyRateLimitPerMinute,
  consumeApiKeyRequest,
  resetApiKeyRateLimits,
} from "../../../apps/api/src/utils/api-key-rate-limit";

const windowStart = 1_700_000_040_000; // a multiple of 60 s

beforeEach(() => {
  resetApiKeyRateLimits();
  vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "2");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API key rate limit", () => {
  it("allows the limit per minute, then refuses until the minute rolls over", async () => {
    const first = await consumeApiKeyRequest("k1", windowStart + 1_000);
    const second = await consumeApiKeyRequest("k1", windowStart + 2_000);
    const third = await consumeApiKeyRequest("k1", windowStart + 59_000);

    expect([first?.allowed, second?.allowed, third?.allowed]).toEqual([
      true,
      true,
      false,
    ]);
    expect([first?.remaining, second?.remaining, third?.remaining]).toEqual([
      1, 0, 0,
    ]);
    expect(third?.reset).toBe((windowStart + 60_000) / 1000);
    expect(third?.retryAfter).toBe(1);

    const next = await consumeApiKeyRequest("k1", windowStart + 60_000);
    expect(next).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("counts each key on its own", async () => {
    await consumeApiKeyRequest("k1", windowStart);
    await consumeApiKeyRequest("k1", windowStart);

    expect(await consumeApiKeyRequest("k2", windowStart)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("reads the limit from the environment; 0 or nonsense disables it", async () => {
    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "");
    expect(apiKeyRateLimitPerMinute()).toBe(600);
    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "0");
    expect(await consumeApiKeyRequest("k1", windowStart)).toBeNull();
    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "-5");
    expect(apiKeyRateLimitPerMinute()).toBe(0);
  });
});
