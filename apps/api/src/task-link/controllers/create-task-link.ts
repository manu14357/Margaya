import { and, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskLinkTable } from "../../database/schema";
import { getTaskLink } from "../serialize";
import { scheduleLinkTitle } from "../title-autofill";
import {
  DUPLICATE_LINK,
  lockLinkTask,
  MAX_TASK_LINKS,
  publishLinkEvent,
  requireLinkTitle,
  requireLinkUrl,
  withDuplicateMapped,
} from "../write";

async function createTaskLink({
  taskId,
  userId,
  url,
  title,
}: {
  taskId: string;
  userId: string;
  url: string;
  title?: string | null;
}) {
  const normalizedUrl = requireLinkUrl(url);
  const normalizedTitle = requireLinkTitle(title);

  const { link, projectId } = await withDuplicateMapped(() =>
    db.transaction(async (tx) => {
      const task = await lockLinkTask(tx, taskId);

      const [existing] = await tx
        .select({ total: count() })
        .from(taskLinkTable)
        .where(eq(taskLinkTable.taskId, taskId));
      if (Number(existing?.total ?? 0) >= MAX_TASK_LINKS) {
        throw new HTTPException(400, {
          message: `A task can have at most ${MAX_TASK_LINKS} links`,
        });
      }

      const [duplicate] = await tx
        .select({ id: taskLinkTable.id })
        .from(taskLinkTable)
        .where(
          and(
            eq(taskLinkTable.taskId, taskId),
            eq(taskLinkTable.url, normalizedUrl),
          ),
        )
        .limit(1);
      if (duplicate) throw new HTTPException(409, { message: DUPLICATE_LINK });

      const [link] = await tx
        .insert(taskLinkTable)
        .values({
          taskId,
          url: normalizedUrl,
          title: normalizedTitle,
          createdBy: userId,
        })
        .returning();
      if (!link) {
        throw new HTTPException(500, { message: "Failed to add the link" });
      }
      return { link, projectId: task.projectId };
    }),
  );

  await publishLinkEvent("task.link_created", {
    link,
    taskId,
    projectId,
    userId,
  });

  // An untitled link shows its URL until the page title arrives.
  if (!link.title) {
    void scheduleLinkTitle({
      linkId: link.id,
      url: link.url,
      taskId,
      projectId,
      userId,
    });
  }

  const created = await getTaskLink(link.id);
  if (!created) throw new HTTPException(404, { message: "Link not found" });
  return created;
}

export default createTaskLink;
