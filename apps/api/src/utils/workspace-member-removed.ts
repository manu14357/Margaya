import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import { endMemberAccess } from "../workspace/end-member-access";
import { publishMembersChanged } from "../workspace/members-realtime";

/**
 * What follows a member leaving a workspace, whether an admin removed them or
 * they left on their own. Both Better Auth paths call this, so the two stay
 * identical. It returns once the person's credentials are dealt with; a
 * failure there is logged and never undoes the removal, because every request
 * re-checks membership anyway.
 */
export async function afterWorkspaceMemberRemoved(
  workspaceId: string,
  userId: string | null | undefined,
  { byThemselves }: { byThemselves: boolean },
) {
  if (userId) {
    await endMemberAccess({ workspaceId, userId, byThemselves }).catch(
      (error) => {
        console.error("Ending access after member removal failed:", error);
      },
    );
  }
  void publishMembersChanged({ workspaceId, userId, accessEnded: true });
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after member remove failed:", error);
  });
}
