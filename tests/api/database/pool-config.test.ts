import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DATABASE_POOL_MAX,
  DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
  resolveDatabasePoolSettings,
} from "../../../apps/api/src/database/pool-config";

describe("resolveDatabasePoolSettings", () => {
  it("uses safe defaults when nothing is set", () => {
    const warn = vi.fn();
    expect(resolveDatabasePoolSettings({}, warn)).toEqual({
      max: DEFAULT_DATABASE_POOL_MAX,
      statementTimeoutMs: DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    });
    expect(DEFAULT_DATABASE_POOL_MAX).toBe(10);
    expect(DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS).toBe(300_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads both variables", () => {
    expect(
      resolveDatabasePoolSettings(
        {
          DATABASE_POOL_MAX: " 25 ",
          DATABASE_STATEMENT_TIMEOUT_MS: "60000",
        },
        vi.fn(),
      ),
    ).toEqual({ max: 25, statementTimeoutMs: 60_000 });
  });

  it("accepts 0 to turn the statement timeout off", () => {
    expect(
      resolveDatabasePoolSettings(
        { DATABASE_STATEMENT_TIMEOUT_MS: "0" },
        vi.fn(),
      ).statementTimeoutMs,
    ).toBe(0);
  });

  it.each([
    ["DATABASE_POOL_MAX", "0"],
    ["DATABASE_POOL_MAX", "-3"],
    ["DATABASE_POOL_MAX", "2.5"],
    ["DATABASE_POOL_MAX", "many"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "-1"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "1e"],
  ])("falls back and warns on %s=%s", (name, value) => {
    const warn = vi.fn();
    const settings = resolveDatabasePoolSettings({ [name]: value }, warn);
    expect(settings).toEqual({
      max: DEFAULT_DATABASE_POOL_MAX,
      statementTimeoutMs: DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
  });

  it("treats a blank value as unset", () => {
    const warn = vi.fn();
    expect(
      resolveDatabasePoolSettings({ DATABASE_POOL_MAX: "  " }, warn).max,
    ).toBe(DEFAULT_DATABASE_POOL_MAX);
    expect(warn).not.toHaveBeenCalled();
  });
});
