// Project lead and default assignee. Both must be members of the project's
// workspace; leaving or being removed from the workspace clears them.

import { and, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, workspaceUserTable } from "../database/schema";
import { publishEvent } from "../events";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export const PROJECT_PEOPLE_FIELDS = [
  "leadUserId",
  "defaultAssigneeUserId",
] as const;
export type ProjectPeopleField = (typeof PROJECT_PEOPLE_FIELDS)[number];
export type ProjectPeople = Partial<Record<ProjectPeopleField, string | null>>;

export const NOT_A_MEMBER: Record<ProjectPeopleField, string> = {
  leadUserId: "The project lead must be a member of the workspace",
  defaultAssigneeUserId:
    "The default assignee must be a member of the workspace",
};

async function workspaceMembers(
  reader: Reader,
  workspaceId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await reader
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        inArray(workspaceUserTable.userId, userIds),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** 400 when a set (non-null) field names someone outside the workspace. */
export async function assertProjectPeople(
  workspaceId: string,
  people: ProjectPeople,
  reader: Reader = db,
): Promise<void> {
  const ids = PROJECT_PEOPLE_FIELDS.map((field) => people[field]).filter(
    (id): id is string => typeof id === "string",
  );
  const members = await workspaceMembers(reader, workspaceId, [
    ...new Set(ids),
  ]);
  for (const field of PROJECT_PEOPLE_FIELDS) {
    const id = people[field];
    if (typeof id === "string" && !members.has(id)) {
      throw new HTTPException(400, { message: NOT_A_MEMBER[field] });
    }
  }
}

/**
 * The project's default assignee while they are still a workspace member,
 * else null. Callers apply it only to tasks that would have no assignee.
 */
export async function projectDefaultAssignee(
  projectId: string,
  reader: Reader = db,
): Promise<string | null> {
  const [row] = await reader
    .select({
      userId: projectTable.defaultAssigneeUserId,
      memberId: workspaceUserTable.userId,
    })
    .from(projectTable)
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, projectTable.defaultAssigneeUserId),
      ),
    )
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row?.userId && row.memberId ? row.userId : null;
}

/**
 * Clears `userId` as lead and default assignee in every project of the
 * workspace. Called on every path that ends a membership (removal by an
 * admin, leaving), after the membership row is gone.
 */
export async function clearMemberProjectRoles(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const projectInWorkspace = eq(projectTable.workspaceId, workspaceId);
  const changed = await db.transaction(async (tx) => {
    const affected = await tx
      .select({
        id: projectTable.id,
        leadUserId: projectTable.leadUserId,
        defaultAssigneeUserId: projectTable.defaultAssigneeUserId,
      })
      .from(projectTable)
      .where(
        and(
          projectInWorkspace,
          or(
            eq(projectTable.leadUserId, userId),
            eq(projectTable.defaultAssigneeUserId, userId),
          ),
        ),
      );
    if (affected.length === 0) return [];
    await tx
      .update(projectTable)
      .set({ leadUserId: null })
      .where(and(projectInWorkspace, eq(projectTable.leadUserId, userId)));
    await tx
      .update(projectTable)
      .set({ defaultAssigneeUserId: null })
      .where(
        and(projectInWorkspace, eq(projectTable.defaultAssigneeUserId, userId)),
      );
    return affected.map((project) => ({
      projectId: project.id,
      fields: PROJECT_PEOPLE_FIELDS.filter(
        (field) => project[field] === userId,
      ),
    }));
  });

  for (const { projectId, fields } of changed) {
    await publishEvent("project.updated", {
      projectId,
      workspaceId,
      userId: null,
      changed: fields,
    });
  }
}
