import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

export const NOT_ASSIGNABLE = "Assignee is not a member of this workspace";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction (writers check inside their own). */
type Reader = Pick<Transaction, "select">;

export async function filterAssignableUsers(
  userIds: string[],
  workspaceId: string,
  reader: Reader = db,
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const memberships = await reader
    .select({ userId: schema.workspaceUserTable.userId })
    .from(schema.workspaceUserTable)
    .where(
      and(
        inArray(schema.workspaceUserTable.userId, userIds),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    );

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = await reader
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(
        inArray(schema.userTable.id, remaining),
        eq(schema.userTable.role, "admin"),
      ),
    );

  for (const admin of admins) {
    assignable.add(admin.id);
  }

  return assignable;
}

export async function assertAssignableUser(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await assertAssignableUsers([userId], workspaceId);
}

/**
 * Every id must be a workspace member (any role) or an instance admin; one
 * that isn't rejects the whole write with a 403. Nothing is filtered out.
 */
export async function assertAssignableUsers(
  userIds: readonly string[],
  workspaceId: string,
  reader: Reader = db,
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  const assignable = await filterAssignableUsers(ids, workspaceId, reader);
  if (ids.some((id) => !assignable.has(id))) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }
}

export async function getProjectWorkspaceId(
  projectId: string,
): Promise<string> {
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
