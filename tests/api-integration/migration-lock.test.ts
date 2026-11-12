import { beforeAll, describe, expect, it } from "vitest";
import { connectDatabaseClient } from "../../apps/api/src/database";
import { withStartupMigrationLock } from "../../apps/api/src/database/migration-lock";
import { ensureTestDatabaseMigrated } from "./helpers/database";

beforeAll(async () => {
  await ensureTestDatabaseMigrated();
});

describe("withStartupMigrationLock", () => {
  it("makes a second instance wait until the first has finished", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const waits: string[] = [];

    const first = withStartupMigrationLock(connectDatabaseClient, async () => {
      order.push("first:start");
      firstStarted();
      await firstHolds;
      order.push("first:end");
    });
    await started;

    const second = withStartupMigrationLock(
      connectDatabaseClient,
      async () => {
        order.push("second:start");
      },
      (message) => waits.push(message),
    );

    // Give the second instance time to reach the lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toEqual(["first:start"]);
    expect(waits).toHaveLength(1);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("releases the lock when a migration fails", async () => {
    await expect(
      withStartupMigrationLock(connectDatabaseClient, async () => {
        throw new Error("migration failed");
      }),
    ).rejects.toThrow("migration failed");

    const waits: string[] = [];
    await withStartupMigrationLock(
      connectDatabaseClient,
      async () => undefined,
      (message) => waits.push(message),
    );
    expect(waits).toHaveLength(0);
  });

  it("runs on a session without a statement timeout", async () => {
    const timeout = await withStartupMigrationLock(
      connectDatabaseClient,
      async (client) => {
        const result = await client.query<{ statement_timeout: string }>(
          "SHOW statement_timeout",
        );
        return result.rows[0]?.statement_timeout;
      },
    );
    expect(timeout).toBe("0");
  });
});
