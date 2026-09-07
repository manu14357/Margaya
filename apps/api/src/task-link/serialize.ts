import { desc, eq, getTableColumns, type SQL } from "drizzle-orm";
import db from "../database";
import { taskLinkTable, userTable } from "../database/schema";
import { displayHost } from "../utils/link-url";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export type TaskLinkRecord = typeof taskLinkTable.$inferSelect;

export const LINK_NOT_FOUND = "Link not found";

/** Links matching `where`, newest first, each with its creator (one join). */
export async function selectTaskLinks(
  where: SQL | undefined,
  reader: Reader = db,
) {
  const rows = await reader
    .select({
      ...getTableColumns(taskLinkTable),
      creatorId: userTable.id,
      creatorName: userTable.name,
      creatorImage: userTable.image,
    })
    .from(taskLinkTable)
    .leftJoin(userTable, eq(userTable.id, taskLinkTable.createdBy))
    .where(where)
    .orderBy(desc(taskLinkTable.createdAt), desc(taskLinkTable.id));

  return rows.map(({ creatorId, creatorName, creatorImage, ...link }) => ({
    ...toTaskLink(link),
    createdBy:
      creatorId && creatorName !== null
        ? { id: creatorId, name: creatorName, image: creatorImage }
        : null,
  }));
}

export type TaskLink = Awaited<ReturnType<typeof selectTaskLinks>>[number];

function toTaskLink(link: TaskLinkRecord) {
  return {
    id: link.id,
    taskId: link.taskId,
    url: link.url,
    title: link.title,
    host: displayHost(link.url),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export async function getTaskLink(linkId: string, reader: Reader = db) {
  const [link] = await selectTaskLinks(eq(taskLinkTable.id, linkId), reader);
  return link ?? null;
}
