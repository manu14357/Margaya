import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "../../apps/api/src/database";
import { withJobLease } from "../../apps/api/src/scheduler/leader-lock";
import { ensureTestDatabaseMigrated } from "./helpers/database";

const LEASE = "integration-test-lease";

async function clearLease() {
  await db.execute(sql`DELETE FROM job_lease WHERE "name" = ${LEASE};`);
}

async function readLease() {
  const rows = await db.execute(
    sql`SELECT "owner", "expires_at" FROM job_lease WHERE "name" = ${LEASE};`,
  );
  return rows.rows[0];
}

beforeAll(async () => {
  await ensureTestDatabaseMigrated();
});

describe("withJobLease", () => {
  it("lets a second caller skip while the first still holds the lease", async () => {
    await clearLease();

    let firstHasLease = false;
    let secondRan = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withJobLease(
      LEASE,
      async () => {
        firstHasLease = true;
        await held;
        return "ran";
      },
      () => "skipped",
    );

    try {
      await vi.waitFor(() => {
        expect(firstHasLease).toBe(true);
      });

      const second = await withJobLease(
        LEASE,
        async () => {
          secondRan = true;
          return "ran";
        },
        () => "skipped",
      );

      expect(second).toBe("skipped");
      expect(secondRan).toBe(false);
    } finally {
      release();
      await expect(first).resolves.toBe("ran");
    }
  });

  it("releases the lease so a later run can take it", async () => {
    await clearLease();

    const first = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );
    const second = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );

    expect(first).toBe("ran");
    expect(second).toBe("ran");
    expect(await readLease()).toBeUndefined();
  });

  it("releases the lease when the job throws", async () => {
    await clearLease();

    await expect(
      withJobLease(
        LEASE,
        async () => {
          throw new Error("job blew up");
        },
        () => "skipped",
      ),
    ).rejects.toThrow("job blew up");

    expect(await readLease()).toBeUndefined();

    const after = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );
    expect(after).toBe("ran");
  });

  it("takes over a lease left behind by a crashed replica", async () => {
    await clearLease();

    await db.execute(sql`
      INSERT INTO job_lease ("name", "owner", "expires_at")
      VALUES (${LEASE}, 'dead-replica', now() - interval '1 minute');
    `);

    const result = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );

    expect(result).toBe("ran");
  });

  it("does not take over a lease that is still live", async () => {
    await clearLease();

    await db.execute(sql`
      INSERT INTO job_lease ("name", "owner", "expires_at")
      VALUES (${LEASE}, 'other-replica', now() + interval '10 minutes');
    `);

    const result = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );

    expect(result).toBe("skipped");
    expect((await readLease())?.owner).toBe("other-replica");

    await clearLease();
  });

  it("holds the lease after a run so another replica skips the slot", async () => {
    await clearLease();

    const first = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
      { leaseMs: 60_000, holdMs: 30 * 60_000 },
    );
    expect(first).toBe("ran");

    const held = await db.execute(sql`
      SELECT "owner",
             extract(epoch from ("expires_at" - now())) AS "seconds_left"
      FROM job_lease WHERE "name" = ${LEASE};
    `);
    const row = held.rows[0] as { owner: string; seconds_left: string };
    expect(row.owner.endsWith(":held")).toBe(true);
    // About 30 minutes from the claim, well past the 1-minute run lease.
    expect(Number(row.seconds_left)).toBeGreaterThan(29 * 60);
    expect(Number(row.seconds_left)).toBeLessThanOrEqual(30 * 60);

    // Another replica's finished run holds the same way and blocks this one.
    await db.execute(sql`
      UPDATE job_lease SET "owner" = 'other-replica:held'
      WHERE "name" = ${LEASE};
    `);
    const elsewhere = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
      { holdMs: 30 * 60_000 },
    );
    expect(elsewhere).toBe("skipped");

    await clearLease();
  });

  it("lets the same instance run again while it holds the lease", async () => {
    await clearLease();
    const options = { holdMs: 30 * 60_000 };

    const first = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
      options,
    );
    const second = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
      options,
    );

    expect(first).toBe("ran");
    expect(second).toBe("ran");
    await clearLease();
  });

  it("releases a held lease when the run fails", async () => {
    await clearLease();

    await expect(
      withJobLease(
        LEASE,
        async () => {
          throw new Error("job blew up");
        },
        () => "skipped",
        { holdMs: 30 * 60_000 },
      ),
    ).rejects.toThrow("job blew up");

    expect(await readLease()).toBeUndefined();
  });

  it("frees the lease when the hold has already passed", async () => {
    await clearLease();

    await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
      { leaseMs: 60_000, holdMs: 1 },
    );
    await db.execute(sql`
      UPDATE job_lease SET "owner" = 'other-replica:held'
      WHERE "name" = ${LEASE};
    `);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const next = await withJobLease(
      LEASE,
      async () => "ran",
      () => "skipped",
    );
    expect(next).toBe("ran");
  });

  it("does not block a different lease name", async () => {
    await clearLease();

    let holderHasLease = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const holder = withJobLease(
      LEASE,
      async () => {
        holderHasLease = true;
        await held;
        return "ran";
      },
      () => "skipped",
    );

    try {
      await vi.waitFor(() => {
        expect(holderHasLease).toBe(true);
      });

      const other = await withJobLease(
        `${LEASE}-other`,
        async () => "ran",
        () => "skipped",
      );

      expect(other).toBe("ran");
    } finally {
      release();
      await holder;
    }
  });
});
