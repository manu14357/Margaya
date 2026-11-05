import { describe, expect, it, vi } from "vitest";
import { getDatabase, getDatabasePool } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";

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
    await expect(response.json()).resolves.toEqual({ status: "ready" });
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
      await expect(response.json()).resolves.toEqual({ status: "unavailable" });

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
