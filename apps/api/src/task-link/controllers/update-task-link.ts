import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskLinkTable } from "../../database/schema";
import { getTaskLink, LINK_NOT_FOUND } from "../serialize";
import {
  DUPLICATE_LINK,
  lockLinkTask,
  publishLinkEvent,
  requireLinkTitle,
  requireLinkUrl,
  withDuplicateMapped,
} from "../write";

/**
 * Changes a link's URL and/or title. Saving the same values changes nothing:
 * no event and no `updatedAt` bump.
 */
async function updateTaskLink({
  taskId,
  linkId,
  userId,
  url,
  title,
}: {
  taskId: string;
  linkId: string;
  userId: string;
  url?: string;
  title?: string | null;
}) {
  if (url === undefined && title === undefined) {
    throw new HTTPException(400, { message: "Provide a URL or a title" });
  }
  const nextUrl = url === undefined ? undefined : requireLinkUrl(url);
  const nextTitle = title === undefined ? undefined : requireLinkTitle(title);

  const change = await withDuplicateMapped(() =>
    db.transaction(async (tx) => {
      const task = await lockLinkTask(tx, taskId);
      const [link] = await tx
        .select()
        .from(taskLinkTable)
        .where(
          and(eq(taskLinkTable.id, linkId), eq(taskLinkTable.taskId, taskId)),
        )
        .limit(1);
      if (!link) throw new HTTPException(404, { message: LINK_NOT_FOUND });

      const values = {
        url: nextUrl ?? link.url,
        title: nextTitle === undefined ? link.title : nextTitle,
      };
      if (values.url === link.url && values.title === link.title) return null;

      if (values.url !== link.url) {
        const [duplicate] = await tx
          .select({ id: taskLinkTable.id })
          .from(taskLinkTable)
          .where(
            and(
              eq(taskLinkTable.taskId, taskId),
              eq(taskLinkTable.url, values.url),
              ne(taskLinkTable.id, linkId),
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new HTTPException(409, { message: DUPLICATE_LINK });
        }
      }

      await tx
        .update(taskLinkTable)
        .set(values)
        .where(eq(taskLinkTable.id, linkId));
      return {
        previous: { id: link.id, url: link.url, title: link.title },
        next: { id: link.id, ...values },
        projectId: task.projectId,
      };
    }),
  );

  if (change) {
    await publishLinkEvent("task.link_updated", {
      link: change.next,
      previous: change.previous,
      taskId,
      projectId: change.projectId,
      userId,
    });
  }

  const updated = await getTaskLink(linkId);
  if (!updated) throw new HTTPException(404, { message: LINK_NOT_FOUND });
  return updated;
}

export default updateTaskLink;
