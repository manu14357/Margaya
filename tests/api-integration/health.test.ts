import { describe, expect, it, vi } from "vitest";
import { getDatabase, getDatabasePool } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  markDraining,
  resetDraining,
} from "../../apps/api/src/observability/lifecycle";

describe("API integration: health", () => {
  it("responds with ok on /api/health", async () => {
    const { app } = createApp();

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports ready on /api/health/ready when the database answers", async () => {
    const { app } = createApp();

    const response = await app.request("/api/health/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      checks: { database: "ok", redis: "disabled", draining: false },
    });
  });

  it("answers 503 while the instance shuts down", async () => {
    const { app } = createApp();
    markDraining();
    try {
      const response = await app.request("/api/health/ready");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "unavailable",
        checks: { database: "ok", draining: true },
      });
      expect((await app.request("/api/health")).status).toBe(200);
    } finally {
      resetDraining();
    }
  });

  it("returns a request ID on every response, keeping a safe incoming one", async () => {
    const { app } = createApp();

    const generated = await app.request("/api/health");
    expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const kept = await app.request("/api/health", {
      headers: { "X-Request-Id": "proxy-1234-abcd" },
    });
    expect(kept.headers.get("x-request-id")).toBe("proxy-1234-abcd");

    const replaced = await app.request("/api/health", {
      headers: { "X-Request-Id": "bad id <forged>" },
    });
    expect(replaced.headers.get("x-request-id")).not.toContain("forged");

    const refused = await app.request("/api/task/unknown-id");
    expect(refused.status).toBe(401);
    expect(refused.headers.get("x-request-id")).toBeTruthy();
  });

  it("answers 503 without details when the database doesn't, and liveness stays ok", async () => {
    const database = getDatabase();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const execute = vi
      .spyOn(database, "execute")
      .mockRejectedValue(new Error("password authentication failed"));
    try {
      const { app } = createApp();

      const response = await app.request("/api/health/ready");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: "unavailable",
        checks: { database: "unavailable", redis: "disabled", draining: false },
      });

      expect((await app.request("/api/health")).status).toBe(200);
    } finally {
      execute.mockRestore();
      error.mockRestore();
    }
  });

  it("survives a dropped idle connection", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // An EventEmitter throws an "error" nobody listens for: that was the crash.
      expect(() =>
        getDatabasePool().emit("error", new Error("server closed")),
      ).not.toThrow();
    } finally {
      error.mockRestore();
    }
  });
});
