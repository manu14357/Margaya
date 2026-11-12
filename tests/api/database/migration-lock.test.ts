import { describe, expect, it, vi } from "vitest";
import {
  STARTUP_MIGRATION_LOCK,
  withStartupMigrationLock,
} from "../../../apps/api/src/database/migration-lock";

function fakeClient(tryLockResult: boolean) {
  const calls: string[] = [];
  const client = {
    calls,
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push(text);
      if (values) expect(values).toEqual([STARTUP_MIGRATION_LOCK]);
      if (text.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: tryLockResult }] };
      }
      return { rows: [] };
    }),
    end: vi.fn(async () => {
      calls.push("end");
    }),
  };
  return client;
}

describe("withStartupMigrationLock", () => {
  it("takes a free lock at once, runs, then closes the session", async () => {
    const client = fakeClient(true);
    const log = vi.fn();

    const result = await withStartupMigrationLock(
      async () => client as never,
      async (received) => {
        expect(received).toBe(client);
        client.calls.push("run");
        return "done";
      },
      log,
    );

    expect(result).toBe("done");
    expect(client.calls).toEqual([
      "SET statement_timeout = 0",
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      "run",
      "end",
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it("waits for the lock when another instance holds it", async () => {
    const client = fakeClient(false);
    const log = vi.fn();

    await withStartupMigrationLock(
      async () => client as never,
      async () => {
        client.calls.push("run");
      },
      log,
    );

    expect(client.calls).toEqual([
      "SET statement_timeout = 0",
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      "run",
      "end",
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Another instance is migrating"),
    );
  });

  it("closes the session, releasing the lock, when a migration fails", async () => {
    const client = fakeClient(true);

    await expect(
      withStartupMigrationLock(
        async () => client as never,
        async () => {
          throw new Error("bad migration");
        },
        vi.fn(),
      ),
    ).rejects.toThrow("bad migration");
    expect(client.end).toHaveBeenCalledOnce();
  });
});
