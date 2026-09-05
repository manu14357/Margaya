import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "../../billing/controllers/find-billable-workspaces";
import { syncWorkspaceSeats } from "../../billing/controllers/sync-seats";
import db from "../../database";
import { workspaceTable, workspaceUserTable } from "../../database/schema";
import { removeUserFromAllAssignments } from "../../task/assignee-writes";
import { purgeWorkspaceExports } from "../../task-export/storage";
import {
  formatBlockedWorkspacesMessage,
  hasOwnerRole,
  planAccountDeletion,
  type WorkspaceMembershipSummary,
} from "../account-deletion";

async function collectMemberships(
  userId: string,
): Promise<WorkspaceMembershipSummary[]> {
  const memberships = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));

  if (memberships.length === 0) {
    return [];
  }

  const workspaceIds = memberships.map((membership) => membership.workspaceId);

  const members = await db
    .select({
      workspaceId: workspaceUserTable.workspaceId,
      workspaceName: workspaceTable.name,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(inArray(workspaceUserTable.workspaceId, workspaceIds));

  return memberships.map((membership) => {
    const workspaceMembers = members.filter(
      (member) => member.workspaceId === membership.workspaceId,
    );

    return {
      workspaceId: membership.workspaceId,
      workspaceName: workspaceMembers[0]?.workspaceName ?? "workspace",
      isOwner: hasOwnerRole(membership.role),
      memberCount: workspaceMembers.length,
      ownerCount: workspaceMembers.filter((member) => hasOwnerRole(member.role))
        .length,
    };
  });
}

export async function deleteAccountData(userId: string) {
  const plan = planAccountDeletion(await collectMemberships(userId));

  if (plan.blockedWorkspaceNames.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBlockedWorkspacesMessage(plan.blockedWorkspaceNames),
    });
  }

  const billable = await findBillableWorkspaces(plan.workspaceIdsToDelete);
  if (billable.length > 0) {
    throw new APIError("CONFLICT", {
      message: formatBillableWorkspacesMessage(
        billable.map((workspace) => workspace.name),
      ),
    });
  }

  if (plan.workspaceIdsToDelete.length > 0) {
    // Export rows cascade with the workspace; stored objects don't.
    for (const workspaceId of plan.workspaceIdsToDelete) {
      await purgeWorkspaceExports(workspaceId).catch((error) => {
        console.error("Export cleanup before workspace delete failed", error);
      });
    }
    await db
      .delete(workspaceTable)
      .where(inArray(workspaceTable.id, plan.workspaceIdsToDelete));
  }

  if (plan.workspaceIdsToLeave.length > 0) {
    await db
      .delete(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, userId),
          inArray(workspaceUserTable.workspaceId, plan.workspaceIdsToLeave),
        ),
      );

    for (const workspaceId of plan.workspaceIdsToLeave) {
      await syncWorkspaceSeats(workspaceId).catch((error) => {
        console.error(
          "Seat sync after account deletion failed:",
          workspaceId,
          error,
        );
      });
    }
  }

  // Before the user row goes: otherwise the mirror's FK would null tasks that
  // still have other assignees.
  await removeUserFromAllAssignments(userId);

  return plan;
}

export default deleteAccountData;
