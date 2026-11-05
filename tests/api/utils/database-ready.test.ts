import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseReady } from "../../../apps/api/src/utils/database-ready";

afterEach(() => vi.restoreAllMocks());

describe("isDatabaseReady", () => {
  it("is true when the check answers", async () => {
    await expect(
      isDatabaseReady(async () => [{ "?column?": 1 }]),
    ).resolves.toBe(true);
  });

  it("is false and logs when the check fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      isDatabaseReady(() => Promise.reject(new Error("connect ECONNREFUSED"))),
    ).resolves.toBe(false);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Readiness check failed"),
      "connect ECONNREFUSED",
    );
  });

  it("logs the driver's reason when the query builder wraps it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = new Error("Failed query: SELECT 1", {
      cause: new Error("connect ECONNREFUSED"),
    });

    await isDatabaseReady(() => Promise.reject(wrapped));

    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      "connect ECONNREFUSED",
    );
  });

  it("is false when the check never answers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(isDatabaseReady(() => new Promise(() => {}), 5)).resolves.toBe(
      false,
    );
  });
});
