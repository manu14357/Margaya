import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskLinkTable, taskTable } from "../../database/schema";
import { LINK_NOT_FOUND } from "../serialize";
import { publishLinkEvent } from "../write";

async function deleteTaskLink({
  taskId,
  linkId,
  userId,
}: {
  taskId: string;
  linkId: string;
  userId: string;
}) {
  const [link] = await db
    .delete(taskLinkTable)
    .where(and(eq(taskLinkTable.id, linkId), eq(taskLinkTable.taskId, taskId)))
    .returning();
  if (!link) throw new HTTPException(404, { message: LINK_NOT_FOUND });

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (task) {
    await publishLinkEvent("task.link_deleted", {
      link,
      taskId,
      projectId: task.projectId,
      userId,
    });
  }

  return { id: link.id };
}

export default deleteTaskLink;
