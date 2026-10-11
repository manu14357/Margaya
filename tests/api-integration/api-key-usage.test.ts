import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetApiKeyRateLimits } from "../../apps/api/src/utils/api-key-rate-limit";
import { resetApiKeyUsageThrottle } from "../../apps/api/src/utils/api-key-usage";
import { createApiKey } from "./helpers/api-keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function lastRequestOf(keyId: string) {
  const [row] = await db
    .select({ lastRequest: schema.apikeyTable.lastRequest })
    .from(schema.apikeyTable)
    .where(eq(schema.apikeyTable.id, keyId));
  return row?.lastRequest ?? null;
}

/** The usage write is fire-and-forget; wait until it lands. */
async function waitForLastRequest(keyId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await lastRequestOf(keyId);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("API integration: API key usage and rate limits", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetApiKeyRateLimits();
    resetApiKeyUsageThrottle();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records last use once a minute, and never for sessions", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const key = await createApiKey(user);
    const { app } = createApp();
    const path = `/api/project?workspaceId=${workspace.id}`;

    expect((await app.request(path, { headers: key.headers })).status).toBe(
      200,
    );
    const first = await waitForLastRequest(key.id);
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs((first as Date).getTime() - Date.now())).toBeLessThan(
      60_000,
    );

    // A sentinel shows whether the next request writes again.
    const sentinel = new Date("2000-01-01T00:00:00Z");
    await db
      .update(schema.apikeyTable)
      .set({ lastRequest: sentinel })
      .where(eq(schema.apikeyTable.id, key.id));
    expect((await app.request(path, { headers: key.headers })).status).toBe(
      200,
    );
    await settle();
    expect(await lastRequestOf(key.id)).toEqual(sentinel);

    const other = await createApiKey(user);
    mockAuthenticatedSession(user);
    expect((await app.request(path)).status).toBe(200);
    await settle();
    expect(await lastRequestOf(other.id)).toBeNull();
  });

  it("limits each key per minute and says so in headers", async () => {
    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "3");
    const { user, workspace } = await createWorkspaceMember();
    const key = await createApiKey(user);
    const second = await createApiKey(user);
    const { app } = createApp();
    const path = `/api/project?workspaceId=${workspace.id}`;

    const remaining: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await app.request(path, { headers: key.headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-RateLimit-Limit")).toBe("3");
      remaining.push(response.headers.get("X-RateLimit-Remaining") ?? "");
      const reset = Number(response.headers.get("X-RateLimit-Reset"));
      expect(reset * 1000).toBeGreaterThan(Date.now());
    }
    expect(remaining).toEqual(["2", "1", "0"]);

    const limited = await app.request(path, { headers: key.headers });
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe("Rate limit exceeded");
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("X-RateLimit-Remaining")).toBe("0");

    const unaffected = await app.request(path, { headers: second.headers });
    expect(unaffected.status).toBe(200);
    expect(unaffected.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("puts the headers on error responses too, and 0 turns limiting off", async () => {
    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "5");
    const { user } = await createWorkspaceMember();
    const key = await createApiKey(user);
    const { app } = createApp();

    const missing = await app.request("/api/task/no-such-task", {
      headers: key.headers,
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.headers.get("X-RateLimit-Limit")).toBe("5");

    vi.stubEnv("API_KEY_RATE_LIMIT_PER_MINUTE", "0");
    const unlimited = await app.request("/api/task/no-such-task", {
      headers: key.headers,
    });
    expect(unlimited.headers.get("X-RateLimit-Limit")).toBeNull();
  });
});
