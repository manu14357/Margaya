import { eq } from "drizzle-orm";
import db from "../database";
import { workspaceUserTable } from "../database/schema";
import { publishEvent, subscribeToEvent } from "../events";
import { broadcastToUser } from "../ws";

// Member lists (pickers, @mentions, the members page) change when someone
// joins, leaves or changes role, and when an agent is added, renamed or
// removed. Every member gets a hint on their user socket (in memory, or over
// Redis with several API instances) and refetches; no member data travels.

type MembersChanged = { workspaceId: string; userId?: string | null };

export async function publishMembersChanged(input: MembersChanged) {
  await publishEvent("workspace.members_changed", input);
}

async function hintMembers({ workspaceId, userId }: MembersChanged) {
  if (!workspaceId) return;
  const members = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  // Someone who just left is no longer a member but still has the list open.
  const userIds = new Set(members.map((member) => member.userId));
  if (userId) userIds.add(userId);
  for (const id of userIds) {
    broadcastToUser(id, { type: "WORKSPACE_MEMBERS_UPDATED", workspaceId });
  }
}

subscribeToEvent<MembersChanged>("workspace.members_changed", hintMembers);
subscribeToEvent<MembersChanged>("agent.changed", hintMembers);
