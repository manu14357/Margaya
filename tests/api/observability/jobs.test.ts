import { beforeEach, describe, expect, it } from "vitest";
import { jobRuns } from "../../../apps/api/src/observability/instruments";
import {
  jobFinished,
  jobStarted,
  listJobStatuses,
  listRecentFailures,
  recordFailure,
  registerJob,
  resetJobTracking,
  safeFailureMessage,
} from "../../../apps/api/src/observability/jobs";

beforeEach(() => resetJobTracking());

describe("job tracking", () => {
  it("lists registered jobs before they run, then their last outcome", () => {
    registerJob("trash-purge");
    expect(listJobStatuses()).toEqual([
      expect.objectContaining({
        name: "trash-purge",
        lastRunAt: null,
        runs: 0,
      }),
    ]);

    const before = jobRuns.get({ job: "trash-purge", outcome: "ok" });
    jobStarted("trash-purge");
    expect(listJobStatuses()[0]?.running).toBe(true);
    jobFinished("trash-purge", "ok", 1234.6);
    const [status] = listJobStatuses();
    expect(status).toMatchObject({
      running: false,
      lastOutcome: "ok",
      lastDurationMs: 1235,
      runs: 1,
      failures: 0,
    });
    expect(status?.lastSuccessAt).toBeInstanceOf(Date);
    expect(jobRuns.get({ job: "trash-purge", outcome: "ok" })).toBe(before + 1);
  });

  it("records failed and degraded runs as recent failures, newest first", () => {
    jobFinished("digest", "degraded", 10);
    jobFinished("flush", "failed", 10, new TypeError("cannot read x"));
    expect(listRecentFailures()).toEqual([
      expect.objectContaining({
        source: "job",
        name: "flush",
        message: "TypeError: cannot read x",
      }),
      expect.objectContaining({ source: "job", name: "digest", message: null }),
    ]);
    expect(listJobStatuses().find((job) => job.name === "flush")).toMatchObject(
      { failures: 1, lastOutcome: "failed" },
    );
  });

  it("keeps at most 50 failures", () => {
    for (let i = 0; i < 60; i += 1) recordFailure("ai", `call ${i}`);
    expect(listRecentFailures(100)).toHaveLength(50);
    expect(listRecentFailures(1)[0]?.name).toBe("call 59");
  });
});

describe("safeFailureMessage", () => {
  it("keeps one short line and drops non-errors", () => {
    expect(safeFailureMessage(new Error("a\n  b"))).toBe("Error: a b");
    expect(safeFailureMessage("x".repeat(500))).toHaveLength(200);
    expect(safeFailureMessage({ secret: "x" })).toBeNull();
    expect(safeFailureMessage(undefined)).toBeNull();
  });
});
