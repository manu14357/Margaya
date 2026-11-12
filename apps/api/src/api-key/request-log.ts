import { and, desc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { matchedRoutes } from "hono/route";
import db from "../database";
import { apiRequestLogTable } from "../database/schema";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../publication/keyset";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";

// The API request log (4.10): one row per REST request made with an API key,
// for its owner. Metadata only: the method, the route template (never the
// concrete path, so no ids or query strings), the status and the duration.
// Never bodies, headers or secrets. Rows are buffered in memory and written
// in batches, so a busy key adds no write per request; a crash loses at most
// one flush interval of rows. API_REQUEST_LOG_ENABLED=false turns it off.

export const DEFAULT_API_REQUEST_LOG_RETENTION_DAYS = 14;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_SIZE = 200;
const MAX_BUFFER = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Entry = typeof apiRequestLogTable.$inferInsert;

let buffer: Entry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

export function apiRequestLogEnabled(
  raw: string | undefined = process.env.API_REQUEST_LOG_ENABLED,
): boolean {
  return raw?.trim().toLowerCase() !== "false";
}

/**
 * Days rows are kept (API_REQUEST_LOG_RETENTION_DAYS, default 14, at most
 * 365). Invalid values fall back to the default.
 */
export function apiRequestLogRetentionDays(
  raw: string | undefined = process.env.API_REQUEST_LOG_RETENTION_DAYS,
): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text))
    return DEFAULT_API_REQUEST_LOG_RETENTION_DAYS;
  const days = Number.parseInt(text, 10);
  return days < 1
    ? DEFAULT_API_REQUEST_LOG_RETENTION_DAYS
    : Math.min(days, 365);
}

/** The route template the request matched, never its concrete path. */
export function routeTemplateOf(c: Context): string {
  // The last matched route that is a handler, not a catch-all middleware:
  // known even when a middleware answered before the handler ran.
  let route = "";
  try {
    const handler = matchedRoutes(c)
      .filter((entry) => entry.method !== "ALL" && !entry.path.endsWith("*"))
      .at(-1);
    route = handler?.path ?? "";
  } catch {
    route = "";
  }
  return route ? route.slice(0, 300) : "(unmatched)";
}

async function writeBatch(rows: Entry[]) {
  try {
    await db.insert(apiRequestLogTable).values(rows);
  } catch (error) {
    // A key deleted meanwhile breaks the foreign key for its rows: retry the
    // rest one by one rather than lose them all, and drop the orphans.
    if (rows.length === 1) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23503") return;
      console.error("Failed to write the API request log", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const row of rows) await writeBatch([row]);
  }
}

/** Writes everything buffered so far. Never throws. */
export async function flushApiRequestLog(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing) await flushing;
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  flushing = (async () => {
    for (let index = 0; index < rows.length; index += 500) {
      await writeBatch(rows.slice(index, index + 500));
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function scheduleFlush() {
  if (buffer.length >= FLUSH_SIZE) {
    void flushApiRequestLog();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushApiRequestLog();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/** Records one API-key request. Never throws, never blocks the response. */
export function recordApiKeyRequest(input: {
  apiKeyId: string;
  method: string;
  route: string;
  status: number;
  startedAt: number;
}): void {
  if (!apiRequestLogEnabled()) return;
  if (buffer.length >= MAX_BUFFER) return;
  buffer.push({
    apiKeyId: input.apiKeyId,
    method: input.method.toUpperCase().slice(0, 10),
    route: input.route,
    status: input.status,
    durationMs: Math.max(0, Math.round(performance.now() - input.startedAt)),
    createdAt: new Date(),
  });
  scheduleFlush();
}

type ListQuery = { apiKeyId: string; cursor?: string; limit: number };

/** Newest first, paged with nextCursor. */
export async function listApiKeyRequests({
  apiKeyId,
  cursor,
  limit,
}: ListQuery) {
  // A request that just finished should show up in the list.
  await flushApiRequestLog();
  const conditions = [eq(apiRequestLogTable.apiKeyId, apiKeyId)];
  if (cursor) {
    conditions.push(
      afterKeyset(
        apiRequestLogTable.createdAt,
        apiRequestLogTable.id,
        decodeKeyset(cursor),
        "desc",
      ),
    );
  }
  const rows = await db
    .select({
      id: apiRequestLogTable.id,
      method: apiRequestLogTable.method,
      route: apiRequestLogTable.route,
      status: apiRequestLogTable.status,
      durationMs: apiRequestLogTable.durationMs,
      createdAt: apiRequestLogTable.createdAt,
      at: timeKey(apiRequestLogTable.createdAt),
    })
    .from(apiRequestLogTable)
    .where(and(...conditions))
    .orderBy(desc(apiRequestLogTable.createdAt), desc(apiRequestLogTable.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ at: _at, ...row }) => row),
    nextCursor:
      rows.length > limit && last ? encodeKeyset(last.at, last.id) : null,
  };
}

export const API_REQUEST_LOG_RETENTION_LEASE = "api-request-log-retention";
const LEASE_MS = 10 * 60 * 1000;

export type RequestLogRetentionLimits = { batch: number; budgetMs: number };

const DEFAULT_LIMITS: RequestLogRetentionLimits = {
  batch: 5000,
  budgetMs: 2 * 60 * 1000,
};

async function purgeOnce(now: Date, limits: RequestLogRetentionLimits) {
  const cutoff = new Date(
    now.getTime() - apiRequestLogRetentionDays() * DAY_MS,
  );
  const startedAt = Date.now();
  let deleted = 0;
  while (Date.now() - startedAt < limits.budgetMs) {
    const result = await db.execute(sql`
      delete from ${apiRequestLogTable}
      where ${apiRequestLogTable.id} in (
        select ${apiRequestLogTable.id} from ${apiRequestLogTable}
        where ${apiRequestLogTable.createdAt} < ${cutoff}
        limit ${limits.batch}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < limits.batch) break;
  }
  if (deleted > 0) console.log(`API request log: deleted ${deleted} old rows`);
  return { degraded: false, deleted };
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runApiRequestLogRetention(
  now: Date = new Date(),
  limits: RequestLogRetentionLimits = DEFAULT_LIMITS,
) {
  return withJobLease(
    API_REQUEST_LOG_RETENTION_LEASE,
    () => purgeOnce(now, limits),
    () => ({ degraded: false, deleted: 0 }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
