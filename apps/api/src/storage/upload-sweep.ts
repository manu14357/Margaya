import { asc, inArray, lt } from "drizzle-orm";
import db from "../database";
import { assetTable, storageUploadTable } from "../database/schema";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";
import { InvalidStorageKeyError, sweepLocalTempFiles } from "./local";
import { deleteS3Object, storageDriver } from "./s3";

// Browser uploads happen in three steps: the API hands out a key (presigned
// S3 PUT or a local upload link), the browser sends the bytes, then the API
// finalizes the key into an asset row. A key whose upload was never
// finalized leaves bytes nothing points at. Each issued key is recorded
// here; a day later, keys without an asset row are deleted from storage.

export const STORAGE_UPLOAD_SWEEP_LEASE = "storage-upload-sweep";
export const ABANDONED_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

const BATCH_SIZE = 200;
const MAX_BATCHES = 10;
const LEASE_MS = 15 * 60 * 1000;

/**
 * Notes a key handed out for a browser upload. Best effort: an upload must
 * not fail because its bookkeeping did, it only stays out of the sweep.
 */
export async function recordPendingUpload(objectKey: string): Promise<void> {
  try {
    await db
      .insert(storageUploadTable)
      .values({ objectKey })
      .onConflictDoNothing();
  } catch (error) {
    console.error("Failed to record a pending upload", error);
  }
}

type SweepOutcome = { removed: number; finalized: number; degraded: boolean };

async function sweepBatch(cutoff: Date, outcome: SweepOutcome) {
  const rows = await db
    .select({ objectKey: storageUploadTable.objectKey })
    .from(storageUploadTable)
    .where(lt(storageUploadTable.createdAt, cutoff))
    .orderBy(asc(storageUploadTable.createdAt))
    .limit(BATCH_SIZE);
  if (rows.length === 0) return { done: true };

  const keys = rows.map((row) => row.objectKey);
  const finalized = new Set(
    (
      await db
        .select({ objectKey: assetTable.objectKey })
        .from(assetTable)
        .where(inArray(assetTable.objectKey, keys))
    ).map((row) => row.objectKey),
  );

  const settled: string[] = [];
  let failed = false;
  for (const key of keys) {
    if (finalized.has(key)) {
      outcome.finalized += 1;
      settled.push(key);
      continue;
    }
    try {
      await deleteS3Object(key);
      outcome.removed += 1;
      settled.push(key);
    } catch (error) {
      if (error instanceof InvalidStorageKeyError) {
        // Not a key this store can hold: nothing to delete.
        settled.push(key);
        continue;
      }
      // Storage is unreachable: keep the row and retry on the next run.
      failed = true;
      outcome.degraded = true;
      console.error("Failed to delete an abandoned upload", error);
    }
  }
  if (settled.length > 0) {
    await db
      .delete(storageUploadTable)
      .where(inArray(storageUploadTable.objectKey, settled));
  }
  return { done: failed || rows.length < BATCH_SIZE };
}

async function runSweep(now: Date): Promise<SweepOutcome> {
  const outcome: SweepOutcome = { removed: 0, finalized: 0, degraded: false };
  const driver = storageDriver();
  // With uploads off there is no storage to clean; rows wait for a driver.
  if (driver === "none") return outcome;
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_AGE_MS);
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { done } = await sweepBatch(cutoff, outcome);
    if (done) break;
  }
  if (driver === "local") {
    try {
      outcome.removed += await sweepLocalTempFiles(cutoff);
    } catch (error) {
      outcome.degraded = true;
      console.error("Failed to sweep temporary upload files", error);
    }
  }
  return outcome;
}

/** Deletes uploads older than a day that never became an asset. */
export async function sweepAbandonedUploads(
  now: Date = new Date(),
): Promise<SweepOutcome> {
  return withJobLease(
    STORAGE_UPLOAD_SWEEP_LEASE,
    () => runSweep(now),
    () => ({ removed: 0, finalized: 0, degraded: false }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
