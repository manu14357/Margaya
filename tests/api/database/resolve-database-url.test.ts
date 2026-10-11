import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveDatabaseConfig,
  resolveDatabaseConnectionString,
} from "../../../apps/api/src/database/resolve-database-url";

const keys = [
  "DATABASE_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
] as const;

describe("resolve-database-url", () => {
  const original: Partial<Record<(typeof keys)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of keys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns DATABASE_URL unchanged when explicitly configured", () => {
    process.env.DATABASE_URL = "postgresql://app:secret@example.com:5433/appdb";

    expect(resolveDatabaseConnectionString()).toBe(
      "postgresql://app:secret@example.com:5433/appdb",
    );

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://app:secret@example.com:5433/appdb",
      source: "DATABASE_URL",
      host: "example.com",
      port: 5433,
      database: "appdb",
      username: "app",
    });
  });

  it("derives DATABASE_URL from POSTGRES_* when a derivation signal is present", () => {
    process.env.POSTGRES_PASSWORD = "password";
    process.env.POSTGRES_HOST = "db.internal";
    process.env.POSTGRES_PORT = "6543";
    process.env.POSTGRES_DB = "margaya_dev";
    process.env.POSTGRES_USER = "margaya";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString:
        "postgresql://margaya:password@db.internal:6543/margaya_dev",
      source: "POSTGRES_ENV",
      host: "db.internal",
      port: 6543,
      database: "margaya_dev",
      username: "margaya",
    });
  });

  it("uses bundled-image defaults when deriving from POSTGRES_PASSWORD alone", () => {
    process.env.POSTGRES_PASSWORD = "password";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://margaya:password@postgres:5432/margaya",
      source: "POSTGRES_ENV",
      host: "postgres",
      port: 5432,
      database: "margaya",
      username: "margaya",
    });
  });

  it("preserves the localhost fallback when only POSTGRES_DB and POSTGRES_USER are set", () => {
    process.env.POSTGRES_DB = "margaya";
    process.env.POSTGRES_USER = "margaya";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://localhost:5432/margaya",
      source: "LOCAL_FALLBACK",
      host: "localhost",
      port: 5432,
      database: "margaya",
      username: "",
    });
  });

  it("throws when derivation is attempted without POSTGRES_PASSWORD", () => {
    process.env.POSTGRES_HOST = "db.internal";

    expect(() => resolveDatabaseConfig()).toThrow(
      "POSTGRES_PASSWORD must be set when deriving DATABASE_URL from POSTGRES_* variables",
    );
  });

  it("exposes safe metadata without a password field", () => {
    process.env.POSTGRES_PASSWORD = "super-secret";

    const config = resolveDatabaseConfig();

    expect(config.logConfig).not.toHaveProperty("password");
    expect(JSON.stringify(config.logConfig)).not.toContain("super-secret");
  });
});
