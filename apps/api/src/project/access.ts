// Project access settings (PLAN 5.1): the open/restricted switch and the
// member list of a restricted project. Who may see what is decided in
// visibility.ts; this file only changes the stored state.

import { DEFAULT_ROLE_NAMES } from "@margaya/permissions";
import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
  workspaceRoleTable,
  workspaceUserTable,
} from "../database/schema";
import { publishEvent } from "../events";
import {
  forgetProjectReach,
  PROJECT_NOT_FOUND,
  type ProjectVisibility,
} from "./visibility";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = Pick<Transaction, "select" | "insert">;

/** The project role given to the people who restrict or create a project. */
export const MANAGING_PROJECT_ROLE = "admin";

export async function getProjectAccess(projectId: string) {
  const [project] = await db
    .select({
      visibility: projectTable.visibility,
      leadUserId: projectTable.leadUserId,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: PROJECT_NOT_FOUND });

  const members = await db
    .select({
      userId: projectMemberTable.userId,
      role: projectMemberTable.role,
      addedAt: projectMemberTable.createdAt,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(projectMemberTable)
    .innerJoin(userTable, eq(userTable.id, projectMemberTable.userId))
    .where(eq(projectMemberTable.projectId, projectId))
    .orderBy(asc(userTable.name), asc(projectMemberTable.userId));

  return {
    visibility: project.visibility,
    leadUserId: project.leadUserId,
    members,
  };
}

/** 400 unless `role` names a role of the workspace (owner excluded). */
export async function assertProjectRole(workspaceId: string, role: string) {
  if ((DEFAULT_ROLE_NAMES as readonly string[]).includes(role)) return;
  const [custom] = await db
    .select({ id: workspaceRoleTable.id })
    .from(workspaceRoleTable)
    .where(
      and(
        eq(workspaceRoleTable.workspaceId, workspaceId),
        eq(workspaceRoleTable.role, role),
      ),
    )
    .limit(1);
  if (!custom) {
    throw new HTTPException(400, {
      message: "role: not a role of this workspace",
    });
  }
}

async function assertWorkspaceMember(workspaceId: string, userId: string) {
  const [member] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new HTTPException(400, {
      message: "userId: not a member of this workspace",
    });
  }
}

/** Adds members that are not there yet; existing roles are kept. */
export async function ensureProjectMembers(
  writer: Writer,
  projectId: string,
  userIds: readonly (string | null | undefined)[],
  addedBy: string | null,
  role = MANAGING_PROJECT_ROLE,
) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  await writer
    .insert(projectMemberTable)
    .values(ids.map((userId) => ({ projectId, userId, role, addedBy })))
    .onConflictDoNothing();
}

export async function publishAccessChange(
  data: {
    projectId: string;
    workspaceId: string;
    userId: string;
  } & (
    | { action: "visibility"; visibility: ProjectVisibility }
    | {
        action: "member_added" | "member_role_changed" | "member_removed";
        memberUserId: string;
        role: string | null;
      }
  ),
) {
  forgetProjectReach();
  await publishEvent("project.access_changed", data);
}

export async function setProjectVisibility(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  visibility: ProjectVisibility;
}) {
  const changed = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        visibility: projectTable.visibility,
        leadUserId: projectTable.leadUserId,
      })
      .from(projectTable)
      .where(eq(projectTable.id, input.projectId))
      .for("update")
      .limit(1);
    if (!project) throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
    if (project.visibility === input.visibility) return false;
    await tx
      .update(projectTable)
      .set({ visibility: input.visibility })
      .where(eq(projectTable.id, input.projectId));
    // Whoever restricts the project, and its lead, keep their access.
    if (input.visibility === "restricted") {
      await ensureProjectMembers(
        tx,
        input.projectId,
        [input.userId, project.leadUserId],
        input.userId,
      );
    }
    return true;
  });
  if (changed) {
    await publishAccessChange({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "visibility",
      visibility: input.visibility,
    });
  }
}

export async function addProjectMember(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  memberUserId: string;
  role: string;
}) {
  await assertWorkspaceMember(input.workspaceId, input.memberUserId);
  await assertProjectRole(input.workspaceId, input.role);
  const inserted = await db
    .insert(projectMemberTable)
    .values({
      projectId: input.projectId,
      userId: input.memberUserId,
      role: input.role,
      addedBy: input.userId,
    })
    .onConflictDoNothing()
    .returning({ userId: projectMemberTable.userId });
  if (inserted.length === 0) {
    throw new HTTPException(409, {
      message: "Already a member of this project",
    });
  }
  await publishAccessChange({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "member_added",
    memberUserId: input.memberUserId,
    role: input.role,
  });
}

export async function updateProjectMemberRole(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  memberUserId: string;
  role: string;
}) {
  await assertProjectRole(input.workspaceId, input.role);
  const updated = await db
    .update(projectMemberTable)
    .set({ role: input.role })
    .where(
      and(
        eq(projectMemberTable.projectId, input.projectId),
        eq(projectMemberTable.userId, input.memberUserId),
      ),
    )
    .returning({ userId: projectMemberTable.userId });
  if (updated.length === 0) {
    throw new HTTPException(404, { message: "Project member not found" });
  }
  await publishAccessChange({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "member_role_changed",
    memberUserId: input.memberUserId,
    role: input.role,
  });
}

export async function removeProjectMember(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  memberUserId: string;
}) {
  const removed = await db
    .delete(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.projectId, input.projectId),
        eq(projectMemberTable.userId, input.memberUserId),
      ),
    )
    .returning({ userId: projectMemberTable.userId });
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Project member not found" });
  }
  await publishAccessChange({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "member_removed",
    memberUserId: input.memberUserId,
    role: null,
  });
}
