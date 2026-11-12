import { Registry } from "./metrics";

// The metric families the API records. This module imports nothing heavy so
// any feature can record into it; values read at scrape time are registered
// by collectors.ts.

export const registry = new Registry();

const SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;
const JOB_BUCKETS = [0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 300, 900] as const;

export const httpRequests = registry.counter(
  "margaya_http_requests_total",
  "HTTP requests answered, by method, route template and status code.",
  ["method", "route", "status"],
);

export const httpDuration = registry.histogram(
  "margaya_http_request_duration_seconds",
  "HTTP request latency, by method and route template.",
  ["method", "route"],
  SECONDS_BUCKETS,
);

export const jobRuns = registry.counter(
  "margaya_job_runs_total",
  "Scheduled job runs, by job and outcome (ok, degraded, failed).",
  ["job", "outcome"],
);

export const jobDuration = registry.histogram(
  "margaya_job_duration_seconds",
  "Scheduled job run time, by job.",
  ["job"],
  JOB_BUCKETS,
);

export const jobLastSuccess = registry.gauge(
  "margaya_job_last_success_timestamp_seconds",
  "Unix time of each job's last run without failures on this instance.",
  ["job"],
);

export const failuresTotal = registry.counter(
  "margaya_failures_total",
  "Operational failures recorded for the health page, by source.",
  ["source"],
);

export const aiCalls = registry.counter(
  "margaya_ai_calls_total",
  "AI model calls, by feature, provider and status.",
  ["feature", "provider", "status"],
);

export const aiTokens = registry.counter(
  "margaya_ai_tokens_total",
  "AI tokens, by provider and kind (input, output, cache_read, cache_write).",
  ["provider", "kind"],
);

export const aiCost = registry.counter(
  "margaya_ai_cost_usd_micros_total",
  "Estimated AI spend in millionths of a US dollar, by provider.",
  ["provider"],
);

/** Route labels: unknown HTTP methods collapse into one series. */
const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export function methodLabel(method: string): string {
  const upper = method.toUpperCase();
  return METHODS.has(upper) ? upper : "OTHER";
}
