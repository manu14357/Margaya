// The projects an invitation adds its invitee to on acceptance, each with a
// project role: inviting a guest and giving them their projects is one step.
// Setting them takes what adding the person later would (project/access-
// routes.ts) for every project named, so an invitation can't share more than
// its sender may.

import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  invitationProjectTable,
  invitationTable,
  projectMemberTable,
  projectTable,
} from "../database/schema";
import { assertProjectRole, publishAccessChange } from "../project/access";
import { canManageProjectAccess } from "../project/access-routes";
import { canSeeProject, PROJECT_NOT_FOUND } from "../project/visibility";
import { roleCeilingError, splitRoles } from "../utils/role-ceiling";
import { INVITATION_NOT_FOUND } from "./access";

export type InvitationProject = { projectId: string; role: string };

/** The invitation's projects, oldest first. */
export async function getInvitationProjects(
  invitationId: string,
): Promise<InvitationProject[]> {
  return db
    .select({
      projectId: invitationProjectTable.projectId,
      role: invitationProjectTable.role,
    })
    .from(invitationProjectTable)
    .where(eq(invitationProjectTable.invitationId, invitationId))
    .orderBy(
      invitationProjectTable.createdAt,
      invitationProjectTable.projectId,
    );
}

/**
 * Replaces the projects a pending invitation adds its invitee to. Every
 * project must be one the caller sees (404) and may manage access to (403),
 * with a role of the workspace (400). Like a role change, the invitation
 * must not grant a workspace role above the caller's own.
 */
export async function setInvitationProjects(
  c: Context,
  input: {
    invitationId: string;
    projects: readonly InvitationProject[];
    instanceAdmin: boolean;
  },
): Promise<InvitationProject[]> {
  const userId = c.get("userId") as string;
  const [invitation] = await db
    .select()
    .from(invitationTable)
    .where(eq(invitationTable.id, input.invitationId))
    .limit(1);
  if (!invitation) {
    throw new HTTPException(404, { message: INVITATION_NOT_FOUND });
  }
  if (invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
    throw new HTTPException(409, {
      message: "Only a pending invitation can change its projects",
    });
  }
  const current = splitRoles(invitation.role);
  const refusal = current.length
    ? await roleCeilingError({
        workspaceId: invitation.workspaceId,
        userId,
        instanceAdmin: input.instanceAdmin,
        roles: current,
      })
    : null;
  if (refusal?.status === 403) {
    throw new HTTPException(403, { message: refusal.message });
  }

  const ids = new Set<string>();
  for (const { projectId, role } of input.projects) {
    if (ids.has(projectId)) {
      throw new HTTPException(400, {
        message: "projects: a project is listed twice",
      });
    }
    ids.add(projectId);
    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, invitation.workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!project || !(await canSeeProject(userId, projectId))) {
      throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
    }
    // The project role caps a restricted project's rights, as on the
    // project's own access routes.
    const previous = c.get("projectId");
    c.set("projectId", projectId);
    try {
      if (!(await canManageProjectAccess(c, projectId))) {
        throw new HTTPException(403, {
          message:
            "Adding someone to a project needs project:share, or being the project lead",
        });
      }
    } finally {
      c.set("projectId", previous);
    }
    await assertProjectRole(invitation.workspaceId, role);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(invitationProjectTable)
      .where(eq(invitationProjectTable.invitationId, invitation.id));
    if (input.projects.length > 0) {
      await tx.insert(invitationProjectTable).values(
        input.projects.map(({ projectId, role }) => ({
          invitationId: invitation.id,
          projectId,
          role,
          addedBy: userId,
        })),
      );
    }
  });
  return getInvitationProjects(invitation.id);
}

/**
 * On acceptance: adds the new member to the invitation's projects that are
 * still in the workspace, with their roles, and announces each like a
 * project member added by hand. A project they already belong to keeps its
 * role.
 */
export async function applyInvitationProjects(input: {
  invitationId: string;
  workspaceId: string;
  userId: string;
  inviterId: string;
}): Promise<void> {
  const rows = await db
    .select({
      projectId: invitationProjectTable.projectId,
      role: invitationProjectTable.role,
      addedBy: invitationProjectTable.addedBy,
    })
    .from(invitationProjectTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, invitationProjectTable.projectId),
    )
    .where(
      and(
        eq(invitationProjectTable.invitationId, input.invitationId),
        eq(projectTable.workspaceId, input.workspaceId),
        isNull(projectTable.deletedAt),
      ),
    );
  for (const row of rows) {
    const addedBy = row.addedBy ?? input.inviterId;
    const inserted = await db
      .insert(projectMemberTable)
      .values({
        projectId: row.projectId,
        userId: input.userId,
        role: row.role,
        addedBy,
      })
      .onConflictDoNothing()
      .returning({ userId: projectMemberTable.userId });
    if (inserted.length === 0) continue;
    await publishAccessChange({
      projectId: row.projectId,
      workspaceId: input.workspaceId,
      userId: addedBy,
      action: "member_added",
      memberUserId: input.userId,
      role: row.role,
    });
  }
}
