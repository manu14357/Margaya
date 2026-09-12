// Plain types and limits of asynchronous task exports. Kept free of runtime
// imports so database/schema.ts can reference them.

export const TASK_EXPORT_FORMATS = ["csv", "json", "xlsx"] as const;
export type TaskExportFormat = (typeof TASK_EXPORT_FORMATS)[number];

export const TASK_EXPORT_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "expired",
] as const;
export type TaskExportStatus = (typeof TASK_EXPORT_STATUSES)[number];

/** Where a finished file lives: object storage, or `task_export_file`. */
export type TaskExportStorage = "s3" | "database";

/** Statuses `export.status_changed` carries; `deleted` means the row is gone. */
export type TaskExportEventStatus = TaskExportStatus | "deleted";

/** Queued plus processing exports one requester may have per workspace. */
export const MAX_ACTIVE_EXPORTS_PER_USER = 3;
export const MAX_EXPORT_PROJECT_IDS = 100;
export const MAX_EXPORT_TASKS = 50_000;
/** Uncompressed bytes an export may encode before it fails. */
export const MAX_EXPORT_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
/** The largest file kept in Postgres when object storage is not set up. */
export const MAX_DATABASE_EXPORT_BYTES = 25 * 1024 * 1024;
/** Runs started per export before an interrupted one is given up. */
export const MAX_EXPORT_ATTEMPTS = 3;
/** Comments per task in an export, newest first. */
export const MAX_EXPORT_COMMENTS = 200;
/** Custom-field columns in CSV and XLSX; JSON always carries every field. */
export const MAX_CUSTOM_FIELD_COLUMNS = 50;
/** History rows are deleted this long after they were created. */
export const EXPORT_HISTORY_DAYS = 90;

export const DEFAULT_EXPORT_RETENTION_DAYS = 7;
