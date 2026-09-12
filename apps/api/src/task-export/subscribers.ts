import { subscribeToEvent } from "../events";
import { broadcastToUser } from "../ws";
import { EXPORT_STATUS_CHANGED, type ExportStatusEvent } from "./events";

// The requester's user socket learns about every status change, whichever
// instance ran the job: user broadcasts fan out through the Redis adapter
// when it is configured and stay local otherwise.
subscribeToEvent<ExportStatusEvent>(EXPORT_STATUS_CHANGED, async (data) => {
  if (!data.userId) return;
  broadcastToUser(data.userId, {
    type: "EXPORT_UPDATED",
    workspaceId: data.workspaceId,
    exportId: data.exportId,
    status: data.status,
  });
});
