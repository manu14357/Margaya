import {
  failuresTotal,
  jobDuration,
  jobLastSuccess,
  jobRuns,
} from "./instruments";

// What the health page shows about background work on this instance: each
// scheduled job's last run, and a short list of recent failures. Both live in
// memory, so they start empty after a restart and each instance has its own.

export type JobOutcome = "ok" | "degraded" | "failed";

export type JobStatus = {
  name: string;
  running: boolean;
  lastRunAt: Date | null;
  lastOutcome: JobOutcome | null;
  lastDurationMs: number | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  runs: number;
  failures: number;
};

export type FailureSource = "job" | "ai" | "email";

export type RecentFailure = {
  source: FailureSource;
  name: string;
  message: string | null;
  at: Date;
};

const MAX_FAILURES = 50;
const MAX_MESSAGE = 200;

const jobs = new Map<string, JobStatus>();
const failures: RecentFailure[] = [];

function statusOf(name: string): JobStatus {
  let status = jobs.get(name);
  if (!status) {
    status = {
      name,
      running: false,
      lastRunAt: null,
      lastOutcome: null,
      lastDurationMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      runs: 0,
      failures: 0,
    };
    jobs.set(name, status);
  }
  return status;
}

/** Lists a job before its first run, so the page shows it as "not run yet". */
export function registerJob(name: string): void {
  statusOf(name);
}

export function jobStarted(name: string, at = new Date()): void {
  const status = statusOf(name);
  status.running = true;
  status.lastRunAt = at;
}

export function jobFinished(
  name: string,
  outcome: JobOutcome,
  durationMs: number,
  error?: unknown,
  at = new Date(),
): void {
  const status = statusOf(name);
  status.running = false;
  status.lastOutcome = outcome;
  status.lastDurationMs = Math.max(0, Math.round(durationMs));
  status.runs += 1;
  jobRuns.inc({ job: name, outcome });
  jobDuration.observe({ job: name }, durationMs / 1000);
  if (outcome === "ok") {
    status.lastSuccessAt = at;
    jobLastSuccess.set({ job: name }, Math.floor(at.getTime() / 1000));
    return;
  }
  status.failures += 1;
  status.lastFailureAt = at;
  // A degraded run handled its own errors per item; they are in the log.
  recordFailure("job", name, outcome === "degraded" ? undefined : error, at);
}

/**
 * A short, single-line message: the error's class and the start of its text.
 * Full details stay in the server log.
 */
export function safeFailureMessage(error: unknown): string | null {
  if (error === undefined || error === null) return null;
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : null;
  if (!text) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_MESSAGE
    ? `${line.slice(0, MAX_MESSAGE - 1)}…`
    : line;
}

export function recordFailure(
  source: FailureSource,
  name: string,
  error?: unknown,
  at = new Date(),
): void {
  failuresTotal.inc({ source });
  failures.unshift({ source, name, message: safeFailureMessage(error), at });
  if (failures.length > MAX_FAILURES) failures.length = MAX_FAILURES;
}

export function listJobStatuses(): JobStatus[] {
  return [...jobs.values()]
    .map((status) => ({ ...status }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listRecentFailures(limit = 20): RecentFailure[] {
  return failures.slice(0, limit).map((failure) => ({ ...failure }));
}

/** Test hook. */
export function resetJobTracking(): void {
  jobs.clear();
  failures.length = 0;
}
