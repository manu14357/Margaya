import {
  DEFAULT_EXPORT_RETENTION_DAYS,
  MAX_DATABASE_EXPORT_BYTES,
  MAX_EXPORT_TASKS,
  MAX_EXPORT_UNCOMPRESSED_BYTES,
} from "./types";

/**
 * The job's size limits. A mutable object so tests can lower a limit
 * instead of producing hundreds of megabytes.
 */
export const exportLimits = {
  maxTasks: MAX_EXPORT_TASKS,
  maxUncompressedBytes: MAX_EXPORT_UNCOMPRESSED_BYTES,
  maxDatabaseBytes: MAX_DATABASE_EXPORT_BYTES,
};

/** Days a finished file stays downloadable (EXPORT_RETENTION_DAYS, 1–30). */
export function exportRetentionDays(): number {
  const raw = process.env.EXPORT_RETENTION_DAYS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_EXPORT_RETENTION_DAYS;
  return Math.min(30, Math.max(1, parsed));
}
