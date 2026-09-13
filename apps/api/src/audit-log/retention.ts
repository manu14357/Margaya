import { sql } from "drizzle-orm";
import db from "../database";
import { auditLogTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { auditLogRetentionDays } from "./settings";

// Hourly, on one instance at a time: entries older than
// AUDIT_LOG_RETENTION_DAYS are deleted in bounded batches. 0 keeps them.

export const AUDIT_LOG_RETENTION_LEASE = "audit-log-retention";
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AuditRetentionLimits = { batch: number; budgetMs: number };

export const DEFAULT_AUDIT_RETENTION_LIMITS: AuditRetentionLimits = {
  batch: 5000,
  budgetMs: 2 * 60 * 1000,
};

export type AuditRetentionOutcome = { degraded: boolean; deleted: number };

async function purgeOnce(
  now: Date,
  limits: AuditRetentionLimits,
): Promise<AuditRetentionOutcome> {
  const days = auditLogRetentionDays();
  if (days === 0) return { degraded: false, deleted: 0 };
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const startedAt = Date.now();
  let deleted = 0;
  while (Date.now() - startedAt < limits.budgetMs) {
    const result = await db.execute(sql`
      delete from ${auditLogTable}
      where ${auditLogTable.id} in (
        select ${auditLogTable.id} from ${auditLogTable}
        where ${auditLogTable.createdAt} < ${cutoff}
        limit ${limits.batch}
      )
    `);
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < limits.batch) break;
  }
  if (deleted > 0) console.log(`audit log: deleted ${deleted} old entries`);
  return { degraded: false, deleted };
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runAuditLogRetention(
  now: Date = new Date(),
  limits: AuditRetentionLimits = DEFAULT_AUDIT_RETENTION_LIMITS,
): Promise<AuditRetentionOutcome> {
  return withJobLease(
    AUDIT_LOG_RETENTION_LEASE,
    () => purgeOnce(now, limits),
    () => ({ degraded: false, deleted: 0 }),
    LEASE_MS,
  );
}
