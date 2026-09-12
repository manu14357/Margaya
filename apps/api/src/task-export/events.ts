import { publishEvent } from "../events";
import type { TaskExportEventStatus } from "./types";

// `export.status_changed` drives the requester's realtime toast and history
// refresh. It is internal only: never an activity, notification or webhook.

export const EXPORT_STATUS_CHANGED = "export.status_changed";

export type ExportStatusEvent = {
  exportId: string;
  workspaceId: string;
  /** The requester; null once their account is gone. */
  userId: string | null;
  status: TaskExportEventStatus;
};

export async function publishExportStatus(
  row: { id: string; workspaceId: string; requestedBy: string | null },
  status: TaskExportEventStatus,
): Promise<void> {
  const event: ExportStatusEvent = {
    exportId: row.id,
    workspaceId: row.workspaceId,
    userId: row.requestedBy,
    status,
  };
  await publishEvent(EXPORT_STATUS_CHANGED, event);
}
