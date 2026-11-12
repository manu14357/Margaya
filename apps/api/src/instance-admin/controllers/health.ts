import { verifySmtpConnection } from "@margaya/email";
import { and, count, eq, gte, max, sql } from "drizzle-orm";
import {
  getAiInstanceConfig,
  hasLocalEndpoint,
} from "../../ai/instance-config";
import db from "../../database";
import { aiUsageTable } from "../../database/schema";
import { getInstanceSettings } from "../../instance-settings/snapshot";
import { listJobStatuses, listRecentFailures } from "../../observability/jobs";
import { checkRedis, processStartedAt } from "../../observability/lifecycle";
import { metricsConfig } from "../../observability/metrics-endpoint";
import { readMigrationState } from "../../observability/migrations";
import { readQueueBacklogs } from "../../observability/queues";
import { openPageRoomCount } from "../../page/collab/rooms";
import { checkStorageHealth } from "../../storage/s3";
import { appVersion } from "../../utils/app-version";
import { isDatabaseReady } from "../../utils/database-ready";
import { localConnectionCounts } from "../../ws";

// The instance health page: one call runs every check in parallel, each with
// its own timeout, so one slow dependency can't hold the page. Answers carry
// states and short codes only: never hosts, buckets, paths or server text.

export type CheckStatus = "ok" | "warning" | "error" | "off";

export type HealthCheck = {
  id: "database" | "redis" | "storage" | "email" | "ai";
  status: CheckStatus;
  code: string | null;
  latencyMs: number | null;
  count: number | null;
};

const CHECK_TIMEOUT_MS = 5_000;
const AI_WINDOW_MS = 24 * 60 * 60 * 1000;

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const started = performance.now();
  const value = await fn();
  return { value, latencyMs: Math.round(performance.now() - started) };
}

async function databaseCheck(): Promise<HealthCheck> {
  const { value: ready, latencyMs } = await timed(() =>
    isDatabaseReady(() => db.execute(sql`select 1`), CHECK_TIMEOUT_MS),
  );
  return {
    id: "database",
    status: ready ? "ok" : "error",
    code: ready ? null : "unreachable",
    latencyMs: ready ? latencyMs : null,
    count: null,
  };
}

async function redisCheck(): Promise<HealthCheck> {
  const result = await checkRedis(CHECK_TIMEOUT_MS);
  return {
    id: "redis",
    status:
      result.state === "ok"
        ? "ok"
        : result.state === "disabled"
          ? "off"
          : "error",
    code: result.state === "ok" ? null : result.state,
    latencyMs: result.latencyMs,
    count: null,
  };
}

async function storageCheck(): Promise<HealthCheck> {
  const result = await checkStorageHealth(CHECK_TIMEOUT_MS);
  return {
    id: "storage",
    status: result.status,
    code: result.code,
    latencyMs: result.latencyMs,
    count: null,
  };
}

async function emailCheck(): Promise<HealthCheck> {
  if (!getInstanceSettings().derived.smtpConfigured) {
    return {
      id: "email",
      status: "off",
      code: "not_configured",
      latencyMs: null,
      count: null,
    };
  }
  const result = await verifySmtpConnection({ timeoutMs: CHECK_TIMEOUT_MS });
  if (!result) {
    return {
      id: "email",
      status: "off",
      code: "not_configured",
      latencyMs: null,
      count: null,
    };
  }
  return {
    id: "email",
    status: result.ok ? "ok" : "error",
    code: result.code,
    latencyMs: result.latencyMs,
    count: null,
  };
}

function aiProviderConfigured(): boolean {
  const config = getAiInstanceConfig();
  if (config.localOnly) return hasLocalEndpoint(config);
  if (config.provider === "anthropic") return Boolean(config.anthropicApiKey);
  if (config.provider === "openai_compatible") {
    return Boolean(config.openai.baseUrl) || hasLocalEndpoint(config);
  }
  return true;
}

/**
 * Without a paid model call: whether AI is on and set up, and how many of
 * the last day's calls failed (the AI ledger keeps counts only).
 */
async function aiCheck(now: Date): Promise<HealthCheck> {
  const config = getAiInstanceConfig();
  if (!config.enabled) {
    return {
      id: "ai",
      status: "off",
      code: "disabled",
      latencyMs: null,
      count: null,
    };
  }
  if (!aiProviderConfigured()) {
    return {
      id: "ai",
      status: "warning",
      code: "not_configured",
      latencyMs: null,
      count: null,
    };
  }
  const since = new Date(now.getTime() - AI_WINDOW_MS);
  const [row] = await db
    .select({ errors: count(), lastAt: max(aiUsageTable.createdAt) })
    .from(aiUsageTable)
    .where(
      and(eq(aiUsageTable.status, "error"), gte(aiUsageTable.createdAt, since)),
    );
  const errors = Number(row?.errors ?? 0);
  return {
    id: "ai",
    status: errors > 0 ? "warning" : "ok",
    code: errors > 0 ? "recent_errors" : null,
    latencyMs: null,
    count: errors,
  };
}

function withTimeout(
  id: HealthCheck["id"],
  check: Promise<HealthCheck>,
): Promise<HealthCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HealthCheck>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          id,
          status: "error",
          code: "timeout",
          latencyMs: null,
          count: null,
        }),
      CHECK_TIMEOUT_MS + 1_000,
    );
  });
  return Promise.race([
    check.catch(
      (): HealthCheck => ({
        id,
        status: "error",
        code: "failed",
        latencyMs: null,
        count: null,
      }),
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

export async function getInstanceHealth(now = new Date()) {
  const startedAt = processStartedAt();
  const [checks, migrations, queues] = await Promise.all([
    Promise.all([
      withTimeout("database", databaseCheck()),
      withTimeout("redis", redisCheck()),
      withTimeout("storage", storageCheck()),
      withTimeout("email", emailCheck()),
      withTimeout("ai", aiCheck(now)),
    ]),
    readMigrationState(),
    readQueueBacklogs(now).catch(() => null),
  ]);
  const connections = localConnectionCounts();
  const metrics = metricsConfig();

  return {
    version: appVersion(),
    nodeVersion: process.version,
    startedAt,
    uptimeSeconds: Math.max(
      0,
      Math.floor((now.getTime() - startedAt.getTime()) / 1000),
    ),
    migrations,
    checks,
    jobs: listJobStatuses(),
    failures: listRecentFailures(20),
    queues,
    connections: {
      project: connections.project,
      user: connections.user,
      pageRooms: openPageRoomCount(),
    },
    metrics: {
      enabled: metrics.enabled,
      token: Boolean(metrics.token),
      port: metrics.port,
    },
  };
}
