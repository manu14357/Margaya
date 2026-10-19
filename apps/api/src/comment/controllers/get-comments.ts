import { and, asc, eq, isNotNull } from "drizzle-orm";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";

async function getComments(taskId: string) {
  const comments = await db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      userId: userTable.id,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      updatedAt: activityTable.updatedAt,
      userName: userTable.name,
      userImage: userTable.image,
      visibility: activityTable.visibility,
      isAnonymous: userTable.isAnonymous,
      memberId: workspaceUserTable.userId,
    })
    .from(activityTable)
    // A deleted author (person or agent) leaves user_id null: the comment
    // stays, without an author.
    .leftJoin(userTable, eq(activityTable.userId, userTable.id))
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    // B12: public board authors may be outside the workspace.
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userTable.id),
      ),
    )
    .where(
      and(
        eq(activityTable.taskId, taskId),
        eq(activityTable.type, "comment"),
        isNotNull(activityTable.content),
      ),
    )
    .orderBy(asc(activityTable.createdAt));

  return comments.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    userId: c.userId,
    content: c.content as string,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    visibility: c.visibility,
    user:
      c.userId === null
        ? null
        : {
            name: c.userName ?? "",
            image: c.userImage,
            isWorkspaceMember: Boolean(c.memberId),
            isGuest: Boolean(c.isAnonymous),
          },
  }));
}

export default getComments;
