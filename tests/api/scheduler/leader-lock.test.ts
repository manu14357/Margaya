import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../apps/api/src/database", () => ({
  default: { execute: (query: SQL) => execute(query) },
}));

const { withJobLease, HOURLY_JOB_HOLD_MS, DAILY_JOB_HOLD_MS } = await import(
  "../../../apps/api/src/scheduler/leader-lock"
);

const dialect = new PgDialect();
const render = (query: SQL) => dialect.sqlToQuery(query);

function statements() {
  return execute.mock.calls.map(([query]) => render(query as SQL));
}

describe("withJobLease", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("skips the run when the lease is held elsewhere", async () => {
    execute.mockResolvedValueOnce({ rowCount: 0 });
    const run = vi.fn();

    const result = await withJobLease("job", run, () => "skipped");

    expect(result).toBe("skipped");
    expect(run).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("claims on the database clock and may retake its own held lease", async () => {
    execute.mockResolvedValue({ rowCount: 1 });

    await withJobLease(
      "job",
      async () => "ran",
      () => "skipped",
      60_000,
    );

    const [claim] = statements();
    expect(claim.sql).toContain("now() + ");
    expect(claim.sql).toContain(`job_lease."owner" = $`);
    expect(claim.params).toContain(60_000);
    expect(
      claim.params.some(
        (param) => typeof param === "string" && param.endsWith(":held"),
      ),
    ).toBe(true);
  });

  it("releases the lease after a run without a hold, as before", async () => {
    execute.mockResolvedValue({ rowCount: 1 });

    await expect(
      withJobLease(
        "job",
        async () => "ran",
        () => "skipped",
      ),
    ).resolves.toBe("ran");

    const [, release] = statements();
    expect(release.sql).toMatch(/^DELETE FROM job_lease/);
  });

  it("keeps the lease for the hold after a successful run", async () => {
    execute.mockResolvedValue({ rowCount: 1 });

    await withJobLease(
      "job",
      async () => "ran",
      () => "skipped",
      {
        leaseMs: 60_000,
        holdMs: HOURLY_JOB_HOLD_MS,
      },
    );

    const [, release] = statements();
    expect(release.sql).toMatch(/^UPDATE job_lease/);
    expect(release.params).toEqual(
      expect.arrayContaining([60_000, HOURLY_JOB_HOLD_MS, "job"]),
    );
    expect(
      release.params.some(
        (param) => typeof param === "string" && param.endsWith(":held"),
      ),
    ).toBe(true);
  });

  it("still releases when a held run fails", async () => {
    execute.mockResolvedValue({ rowCount: 1 });

    await expect(
      withJobLease(
        "job",
        async () => {
          throw new Error("boom");
        },
        () => "skipped",
        { holdMs: DAILY_JOB_HOLD_MS },
      ),
    ).rejects.toThrow("boom");

    const [, release] = statements();
    expect(release.sql).toMatch(/^DELETE FROM job_lease/);
  });

  it("holds hourly jobs for half an hour and daily jobs for half a day", () => {
    expect(HOURLY_JOB_HOLD_MS).toBe(30 * 60 * 1000);
    expect(DAILY_JOB_HOLD_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("logs instead of throwing when the release fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    execute
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error("connection lost"));

    await expect(
      withJobLease(
        "job",
        async () => "ran",
        () => "skipped",
      ),
    ).resolves.toBe("ran");
    expect(error).toHaveBeenCalledWith(
      "Failed to release the job lease",
      expect.any(Error),
    );
    error.mockRestore();
  });
});
