import { and, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskDescriptionVersionTable, userTable } from "../database/schema";
import updateTaskDescription from "../task/controllers/update-task-description";
import { plainTextPreview } from "../utils/plain-text-preview";
import {
  DESCRIPTION_VERSION_LIMIT,
  DESCRIPTION_VERSION_PREVIEW_LENGTH,
} from "./rules";

export const VERSION_NOT_FOUND = "Version not found";

// The preview reads a bounded head of the text, never the whole of a large
// description.
const PREVIEW_SOURCE_CHARS = 2000;

const summaryColumns = {
  id: taskDescriptionVersionTable.id,
  taskId: taskDescriptionVersionTable.taskId,
  authorId: taskDescriptionVersionTable.authorId,
  savedAt: taskDescriptionVersionTable.savedAt,
  createdAt: taskDescriptionVersionTable.createdAt,
  size: sql<number>`char_length(${taskDescriptionVersionTable.content})`.mapWith(
    Number,
  ),
  authorName: userTable.name,
  authorImage: userTable.image,
};

type SummaryRow = {
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
};

function withAuthor<T extends SummaryRow>(row: T) {
  const { authorName, authorImage, ...rest } = row;
  return {
    ...rest,
    author:
      row.authorId && authorName !== null
        ? { id: row.authorId, name: authorName, image: authorImage }
        : null,
  };
}

/** A task's saved description versions, newest first. */
export async function listDescriptionVersions(taskId: string) {
  const rows = await db
    .select({
      ...summaryColumns,
      head: sql<string>`left(${taskDescriptionVersionTable.content}, ${PREVIEW_SOURCE_CHARS})`,
    })
    .from(taskDescriptionVersionTable)
    .leftJoin(userTable, eq(userTable.id, taskDescriptionVersionTable.authorId))
    .where(eq(taskDescriptionVersionTable.taskId, taskId))
    .orderBy(
      desc(taskDescriptionVersionTable.savedAt),
      desc(taskDescriptionVersionTable.id),
    )
    .limit(DESCRIPTION_VERSION_LIMIT);

  return rows.map(({ head, ...row }) => ({
    ...withAuthor(row),
    preview: plainTextPreview(head, DESCRIPTION_VERSION_PREVIEW_LENGTH),
  }));
}

/** One version of this task's description, with its text. */
export async function getDescriptionVersion(taskId: string, versionId: string) {
  const [row] = await db
    .select({
      ...summaryColumns,
      content: taskDescriptionVersionTable.content,
    })
    .from(taskDescriptionVersionTable)
    .leftJoin(userTable, eq(userTable.id, taskDescriptionVersionTable.authorId))
    .where(
      and(
        eq(taskDescriptionVersionTable.id, versionId),
        eq(taskDescriptionVersionTable.taskId, taskId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: VERSION_NOT_FOUND });
  return withAuthor(row);
}

/**
 * Writes a version's text through the normal description update, so the
 * activity row, events, realtime updates and mentions follow as for any
 * edit. The restore itself is recorded as a new version.
 */
export async function restoreDescriptionVersion({
  taskId,
  versionId,
  userId,
}: {
  taskId: string;
  versionId: string;
  userId: string;
}) {
  const version = await getDescriptionVersion(taskId, versionId);
  return updateTaskDescription({
    id: taskId,
    description: version.content,
    currentUserId: userId,
    forceNewVersion: true,
  });
}
