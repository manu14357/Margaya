import * as Sentry from "@sentry/node";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import db from "../database";
import { taskExportFileTable, taskExportTable } from "../database/schema";
import { putPrivateObject } from "../storage/s3";
import { publishExportStatus } from "./events";
import {
  type BuiltExport,
  buildExport,
  EXPORT_FAILED,
  ExportFailure,
  type TaskExportRow,
} from "./job";
import { exportLimits, exportRetentionDays } from "./settings";
import {
  deleteExportFileQuietly,
  exportObjectKey,
  isObjectStorageConfigured,
} from "./storage";
import { MAX_EXPORT_ATTEMPTS } from "./types";

// The in-process export runner. Each instance runs at most one export at a
// time. Claims use FOR UPDATE SKIP LOCKED under a lease that a heartbeat
// extends, so any number of instances share the queue without Redis or a
// leader; `recoverExports` (every minute) requeues work a crash left behind.

const LEASE_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const EXPORT_INTERRUPTED = "The export was interrupted. Try again.";
export const DATABASE_STORAGE_TOO_LARGE =
  "This export is larger than 25 MB, which needs object storage (S3). Ask your administrator, or choose fewer projects.";

let active: Promise<void> | null = null;
let rerun = false;
let stopped = false;

/** Claims the oldest queued export, or null when the queue is empty. */
export async function claimNextExport(
  now: Date = new Date(),
): Promise<TaskExportRow | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: taskExportTable.id, attempts: taskExportTable.attempts })
      .from(taskExportTable)
      .where(eq(taskExportTable.status, "queued"))
      .orderBy(asc(taskExportTable.createdAt), asc(taskExportTable.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [claimed] = await tx
      .update(taskExportTable)
      .set({
        status: "processing",
        startedAt: now,
        attempts: next.attempts + 1,
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        error: null,
      })
      .where(eq(taskExportTable.id, next.id))
      .returning();
    return claimed ?? null;
  });
}

/** This run still owns the row: still processing, and not reclaimed since. */
function ownedBy(row: TaskExportRow) {
  return and(
    eq(taskExportTable.id, row.id),
    eq(taskExportTable.status, "processing"),
    eq(taskExportTable.attempts, row.attempts),
  );
}

async function extendLease(row: TaskExportRow): Promise<void> {
  await db
    .update(taskExportTable)
    .set({ lockedUntil: new Date(Date.now() + LEASE_MS) })
    .where(ownedBy(row));
}

async function completeExport(
  row: TaskExportRow,
  built: BuiltExport,
): Promise<boolean> {
  const completedAt = new Date();
  const finished = {
    status: "completed" as const,
    error: null,
    taskCount: built.taskCount,
    fileName: built.fileName,
    contentType: built.contentType,
    sizeBytes: built.body.length,
    lockedUntil: null,
    completedAt,
    expiresAt: new Date(completedAt.getTime() + exportRetentionDays() * DAY_MS),
  };

  if (isObjectStorageConfigured()) {
    const objectKey = exportObjectKey(row.workspaceId, row.id, built.fileName);
    await putPrivateObject(objectKey, built.body, built.contentType);
    const [updated] = await db
      .update(taskExportTable)
      .set({ ...finished, storage: "s3", objectKey })
      .where(ownedBy(row))
      .returning({ id: taskExportTable.id });
    if (!updated) {
      await deleteExportFileQuietly({ id: row.id, storage: "s3", objectKey });
    }
    return Boolean(updated);
  }

  if (built.body.length > exportLimits.maxDatabaseBytes) {
    throw new ExportFailure(DATABASE_STORAGE_TOO_LARGE);
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(taskExportTable)
      .set({ ...finished, storage: "database", objectKey: null })
      .where(ownedBy(row))
      .returning({ id: taskExportTable.id });
    if (!updated) return false;
    await tx
      .insert(taskExportFileTable)
      .values({ exportId: row.id, content: built.body })
      .onConflictDoUpdate({
        target: taskExportFileTable.exportId,
        set: { content: built.body, createdAt: completedAt },
      });
    return true;
  });
}

async function failExport(row: TaskExportRow, message: string) {
  const [failed] = await db
    .update(taskExportTable)
    .set({
      status: "failed",
      error: message,
      lockedUntil: null,
      completedAt: new Date(),
    })
    .where(ownedBy(row))
    .returning({ id: taskExportTable.id });
  if (failed) await publishExportStatus(row, "failed");
}

/** Builds, stores and completes a claimed export, or fails it safely. */
export async function processExport(
  row: TaskExportRow,
  now: Date = new Date(),
): Promise<void> {
  await publishExportStatus(row, "processing");
  const heartbeat = setInterval(() => {
    extendLease(row).catch((error) => {
      console.error(`exports: lease renewal failed for ${row.id}`, error);
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    const built = await buildExport(row, now);
    if (await completeExport(row, built)) {
      await publishExportStatus(row, "completed");
    }
  } catch (error) {
    if (!(error instanceof ExportFailure)) {
      // The id only: titles and other workspace data never reach the logs.
      console.error(`exports: export ${row.id} failed`, error);
      Sentry.captureException(error, {
        tags: { area: "task-export", exportId: row.id },
      });
    }
    await failExport(
      row,
      error instanceof ExportFailure ? error.message : EXPORT_FAILED,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

/** Claims and runs one queued export; returns its id, or null when idle. */
export async function runNextExport(
  now: Date = new Date(),
): Promise<string | null> {
  const row = await claimNextExport(now);
  if (!row) return null;
  await processExport(row, now);
  return row.id;
}

/**
 * Starts this instance's runner unless it is already running (then it
 * looks at the queue again when done). Resolves when the runner is idle.
 */
export function kickExportRunner(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (active) {
    rerun = true;
    return active;
  }
  const drain = async () => {
    while (!stopped) {
      if ((await runNextExport()) === null) return;
    }
  };
  const run = (async () => {
    try {
      do {
        rerun = false;
        await drain();
      } while (rerun && !stopped);
    } catch (error) {
      console.error("exports: the runner stopped", error);
      Sentry.captureException(error, { tags: { area: "task-export" } });
    } finally {
      active = null;
    }
  })();
  active = run;
  return run;
}

/** Stops claiming new exports (shutdown); a running one finishes. */
export function stopExportRunner(): void {
  stopped = true;
}

/** Allows claiming again after `stopExportRunner`. */
export function startExportRunner(): void {
  stopped = false;
}

/**
 * Requeues exports whose lease ran out (a crashed or stopped instance), up
 * to three runs in total, then fails them. Then nudges the runner, so
 * queued work also starts on instances that received no request.
 */
export async function recoverExports(now: Date = new Date()) {
  const expired = and(
    eq(taskExportTable.status, "processing"),
    lt(taskExportTable.lockedUntil, now),
  );
  const requeued = await db
    .update(taskExportTable)
    .set({ status: "queued", lockedUntil: null })
    .where(and(expired, lt(taskExportTable.attempts, MAX_EXPORT_ATTEMPTS)))
    .returning();
  const failed = await db
    .update(taskExportTable)
    .set({
      status: "failed",
      error: EXPORT_INTERRUPTED,
      lockedUntil: null,
      completedAt: now,
    })
    .where(and(expired, gte(taskExportTable.attempts, MAX_EXPORT_ATTEMPTS)))
    .returning();
  for (const row of requeued) await publishExportStatus(row, "queued");
  for (const row of failed) await publishExportStatus(row, "failed");

  void kickExportRunner();
  return {
    degraded: false,
    requeued: requeued.length,
    failed: failed.length,
  };
}
