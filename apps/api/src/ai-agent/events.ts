import { publishEvent, subscribeToEvent } from "../events";
import { broadcastToUser } from "../ws";

// Agent realtime: runs and approvals change in the background, so the
// people who care get a hint on their user socket (in memory, or over
// Redis when several API instances run) and refetch.

export type RunUpdate = {
  workspaceId: string;
  runId: string;
  principalUserId: string | null;
  taskId: string | null;
  status: string;
};

export async function publishRunUpdated(update: RunUpdate) {
  await publishEvent("ai.run_updated", update);
}

subscribeToEvent<RunUpdate>("ai.run_updated", async (data) => {
  if (!data.principalUserId) return;
  broadcastToUser(data.principalUserId, {
    type: "AI_RUNS_UPDATED",
    workspaceId: data.workspaceId,
    runId: data.runId,
    taskId: data.taskId,
  });
});

subscribeToEvent<{ workspaceId: string; userId: string }>(
  "ai.approval_requested",
  async (data) => {
    broadcastToUser(data.userId, {
      type: "AI_APPROVALS_UPDATED",
      workspaceId: data.workspaceId,
    });
  },
);
