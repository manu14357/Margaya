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

export const TASK_EXPORT_KINDS = ["tasks", "workspace"] as const;
export type TaskExportKind = (typeof TASK_EXPORT_KINDS)[number];

/**
 * Where a finished file lives: object storage, `task_export_file`, or (only
 * whole-workspace exports, which carry the store's files) the local store.
 */
export type TaskExportStorage = "s3" | "database" | "local";

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

/**
 * Starting or reaching a whole-workspace export: managing settings, and reading
 * everything an archive holds, so a custom role can't read through one what it
 * can't read directly. page:delete is what shows ownerless private pages
 * (page/rules.ts). Owners and admins hold all of it.
 */
export const WORKSPACE_EXPORT_PERMISSIONS: Record<string, string[]> = {
  workspace: ["manage_settings"],
  project: ["read"],
  task: ["read"],
  label: ["read"],
  cycle: ["read"],
  module: ["read"],
  page: ["read", "delete"],
};

/** The largest whole-workspace archive: under the ZIP32 and single-PUT limits. */
export const MAX_WORKSPACE_EXPORT_BYTES = 4_000_000_000;
/** Files one whole-workspace archive can hold: under ZIP32's 65,535 entries. */
export const MAX_WORKSPACE_EXPORT_FILES = 60_000;
