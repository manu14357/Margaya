import { sql } from "drizzle-orm";
import db from "../database";
import { instanceAuditLogTable } from "../database/schema";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";

// Hourly, on one instance at a time: instance audit entries older than
// INSTANCE_AUDIT_LOG_RETENTION_DAYS (default 365) are deleted in bounded
// batches. 0 keeps them forever.

export const DEFAULT_INSTANCE_AUDIT_RETENTION_DAYS = 365;
export const INSTANCE_AUDIT_RETENTION_LEASE = "instance-audit-log-retention";
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Invalid or negative values fall back to the default; 0 keeps forever. */
export function instanceAuditRetentionDays(
  raw: string | undefined = process.env.INSTANCE_AUDIT_LOG_RETENTION_DAYS,
): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text))
    return DEFAULT_INSTANCE_AUDIT_RETENTION_DAYS;
  return Math.min(Number.parseInt(text, 10), 36_500);
}

export type InstanceAuditRetentionLimits = { batch: number; budgetMs: number };

const DEFAULT_LIMITS: InstanceAuditRetentionLimits = {
  batch: 5000,
  budgetMs: 2 * 60 * 1000,
};

async function purgeOnce(now: Date, limits: InstanceAuditRetentionLimits) {
  const days = instanceAuditRetentionDays();
  if (days === 0) return { degraded: false, deleted: 0 };
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const startedAt = Date.now();
  let deleted = 0;
  while (Date.now() - startedAt < limits.budgetMs) {
    const result = await db.execute(sql`
      delete from ${instanceAuditLogTable}
      where ${instanceAuditLogTable.id} in (
        select ${instanceAuditLogTable.id} from ${instanceAuditLogTable}
        where ${instanceAuditLogTable.createdAt} < ${cutoff}
        limit ${limits.batch}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < limits.batch) break;
  }
  if (deleted > 0) {
    console.log(`instance audit trail: deleted ${deleted} old entries`);
  }
  return { degraded: false, deleted };
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runInstanceAuditRetention(
  now: Date = new Date(),
  limits: InstanceAuditRetentionLimits = DEFAULT_LIMITS,
) {
  return withJobLease(
    INSTANCE_AUDIT_RETENTION_LEASE,
    () => purgeOnce(now, limits),
    () => ({ degraded: false, deleted: 0 }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
