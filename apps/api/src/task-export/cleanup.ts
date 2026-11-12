import { and, asc, eq, lt, ne, notInArray } from "drizzle-orm";
import db from "../database";
import { taskExportTable } from "../database/schema";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";
import { sweepAbandonedArchives } from "../workspace-export/build";
import { publishExportStatus } from "./events";
import { deleteExportFileQuietly } from "./storage";
import { EXPORT_HISTORY_DAYS } from "./types";

// Hourly, on one instance at a time: finished files are deleted once they
// expire (the row stays as history, marked expired), and history rows are
// deleted 90 days after they were created. Bounded per tick.

export const TASK_EXPORT_CLEANUP_LEASE = "task-export-cleanup";
const LEASE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExportCleanupLimits = { batch: number; budgetMs: number };

export const DEFAULT_EXPORT_CLEANUP_LIMITS: ExportCleanupLimits = {
  batch: 200,
  budgetMs: 2 * 60 * 1000,
};

export type ExportCleanupOutcome = {
  degraded: boolean;
  expired: number;
  deleted: number;
};

const fileColumns = {
  id: taskExportTable.id,
  workspaceId: taskExportTable.workspaceId,
  requestedBy: taskExportTable.requestedBy,
  storage: taskExportTable.storage,
  objectKey: taskExportTable.objectKey,
};

async function cleanupOnce(
  now: Date,
  limits: ExportCleanupLimits,
): Promise<ExportCleanupOutcome> {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt >= limits.budgetMs;
  const outcome: ExportCleanupOutcome = {
    degraded: false,
    expired: 0,
    deleted: 0,
  };
  // Rows whose file could not be deleted are retried on the next tick.
  const skipped: string[] = [];
  const notSkipped = () =>
    skipped.length > 0 ? notInArray(taskExportTable.id, skipped) : undefined;

  while (!outOfTime()) {
    const due = await db
      .select(fileColumns)
      .from(taskExportTable)
      .where(
        and(
          eq(taskExportTable.status, "completed"),
          lt(taskExportTable.expiresAt, now),
          notSkipped(),
        ),
      )
      .orderBy(asc(taskExportTable.expiresAt), asc(taskExportTable.id))
      .limit(limits.batch);
    if (due.length === 0) break;
    for (const row of due) {
      if (!(await deleteExportFileQuietly(row))) {
        skipped.push(row.id);
        outcome.degraded = true;
        continue;
      }
      const [expired] = await db
        .update(taskExportTable)
        .set({ status: "expired", objectKey: null })
        .where(
          and(
            eq(taskExportTable.id, row.id),
            eq(taskExportTable.status, "completed"),
          ),
        )
        .returning({ id: taskExportTable.id });
      if (expired) {
        outcome.expired += 1;
        await publishExportStatus(row, "expired");
      }
    }
  }

  const cutoff = new Date(now.getTime() - EXPORT_HISTORY_DAYS * DAY_MS);
  while (!outOfTime()) {
    const old = await db
      .select(fileColumns)
      .from(taskExportTable)
      .where(
        and(
          lt(taskExportTable.createdAt, cutoff),
          ne(taskExportTable.status, "processing"),
          notSkipped(),
        ),
      )
      .orderBy(asc(taskExportTable.createdAt), asc(taskExportTable.id))
      .limit(limits.batch);
    if (old.length === 0) break;
    for (const row of old) {
      if (row.objectKey && !(await deleteExportFileQuietly(row))) {
        skipped.push(row.id);
        outcome.degraded = true;
        continue;
      }
      // Database-stored files cascade with the row.
      const removed = await db
        .delete(taskExportTable)
        .where(
          and(
            eq(taskExportTable.id, row.id),
            ne(taskExportTable.status, "processing"),
          ),
        )
        .returning({ id: taskExportTable.id });
      outcome.deleted += removed.length;
    }
  }

  if (outcome.expired + outcome.deleted > 0) {
    console.log(
      `exports: expired ${outcome.expired} files and deleted ${outcome.deleted} history rows`,
    );
  }
  return outcome;
}

/**
 * The scheduler entry: one bounded pass on one instance at a time. Every
 * instance first sweeps its own temp folder, which no other can reach, by the
 * clock rather than `now`, so a pass for a later date can't take a live run's
 * archive.
 */
export async function runExportCleanup(
  now: Date = new Date(),
  limits: ExportCleanupLimits = DEFAULT_EXPORT_CLEANUP_LIMITS,
): Promise<ExportCleanupOutcome> {
  await sweepAbandonedArchives().catch((error) => {
    console.error(
      "exports: sweeping abandoned workspace archives failed",
      error,
    );
  });
  return withJobLease(
    TASK_EXPORT_CLEANUP_LEASE,
    () => cleanupOnce(now, limits),
    () => ({ degraded: false, expired: 0, deleted: 0 }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
