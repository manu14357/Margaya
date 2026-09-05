import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";

/**
 * What follows a member leaving a workspace, whether an admin removed them or
 * they left on their own. Both Better Auth paths call this, so the two stay
 * identical.
 */
export function afterWorkspaceMemberRemoved(workspaceId: string) {
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after member remove failed:", error);
  });
}
