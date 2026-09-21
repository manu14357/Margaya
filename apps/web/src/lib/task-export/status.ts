import type { TaskExportStatus } from "@/types/task-export";

type ExportStatusRow = {
  status: TaskExportStatus;
  expiresAt: string | null;
};

/** Queued or processing: the history keeps polling while one is visible. */
export function isExportActive(row: { status: TaskExportStatus }): boolean {
  return row.status === "queued" || row.status === "processing";
}

/** Completed and still inside its download window (expiresAt is exclusive). */
export function canDownload(row: ExportStatusRow, now = new Date()): boolean {
  if (row.status !== "completed" || !row.expiresAt) return false;
  return new Date(row.expiresAt).getTime() > now.getTime();
}

/**
 * The status to show: a completed file whose window has passed reads as
 * expired before the hourly cleanup marks the row.
 */
export function displayExportStatus(
  row: ExportStatusRow,
  now = new Date(),
): TaskExportStatus {
  if (row.status === "completed" && !canDownload(row, now)) return "expired";
  return row.status;
}
