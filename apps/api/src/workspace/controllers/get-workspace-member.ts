import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";

export const MEMBER_NOT_FOUND = "Member not found";

/**
 * One current member of the workspace, for their profile; 404 for anyone
 * else, so a profile never reveals people outside the workspace. The email
 * is included because the members list already shows every member's email
 * to every member.
 */
async function getWorkspaceMember(workspaceId: string, userId: string) {
  const [member] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: workspaceUserTable.role,
      kind: userTable.kind,
      joinedAt: workspaceUserTable.joinedAt,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) throw new HTTPException(404, { message: MEMBER_NOT_FOUND });
  return member;
}

export default getWorkspaceMember;
