import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import { publishMembersChanged } from "../workspace/members-realtime";

/**
 * What follows a member leaving a workspace, whether an admin removed them or
 * they left on their own. Both Better Auth paths call this, so the two stay
 * identical.
 */
export function afterWorkspaceMemberRemoved(
  workspaceId: string,
  userId?: string | null,
) {
  void publishMembersChanged({ workspaceId, userId });
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after member remove failed:", error);
  });
}
