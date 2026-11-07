import { eq } from "drizzle-orm";
import db from "../database";
import { projectTable, workspaceUserTable } from "../database/schema";
import { publishEvent, subscribeToEvent } from "../events";
import {
  broadcastToProject,
  broadcastToUser,
  PROJECT_ACCESS_CHANGED,
} from "../ws";

// Member lists (pickers, @mentions, the members page) change when someone
// joins, leaves or changes role, and when an agent is added, renamed or
// removed. Every member gets a hint on their user socket (in memory, or over
// Redis with several API instances) and refetches; no member data travels.

type MembersChanged = {
  workspaceId: string;
  userId?: string | null;
  /** Someone left or was removed: their open sockets must not stay. */
  accessEnded?: boolean;
};

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

/**
 * Each instance re-checks its sockets on the workspace's projects and closes
 * those that lost access (ws/index.ts). Page sockets follow the same event
 * (page/collab/subscribers.ts).
 */
async function recheckProjectSockets({
  workspaceId,
  accessEnded,
}: MembersChanged) {
  if (!workspaceId || !accessEnded) return;
  const projects = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
  for (const { id } of projects) {
    broadcastToProject(id, { type: PROJECT_ACCESS_CHANGED, projectId: id });
  }
}

subscribeToEvent<MembersChanged>("workspace.members_changed", hintMembers);
subscribeToEvent<MembersChanged>(
  "workspace.members_changed",
  recheckProjectSockets,
);
subscribeToEvent<MembersChanged>("agent.changed", hintMembers);
