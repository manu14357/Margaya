import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  assetTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export const ATTACHMENT_SURFACE = "attachment";
export const MAX_TASK_ATTACHMENTS = 100;
export const ATTACHMENT_NOT_FOUND = "Attachment not found";
export const UPLOADS_NOT_CONFIGURED =
  "File uploads are not configured on this instance";
export const KEY_MISMATCH = "Upload key does not match this task";

/** An attachment of this task: an asset row with the attachment surface. */
export function isTaskAttachment(taskId: string): SQL {
  return and(
    eq(assetTable.taskId, taskId),
    eq(assetTable.surface, ATTACHMENT_SURFACE),
  ) as SQL;
}

/** Attachments matching `where`, newest first, with the uploader. */
export async function selectAttachments(where: SQL, reader: Reader = db) {
  return reader
    .select({
      id: assetTable.id,
      taskId: assetTable.taskId,
      filename: assetTable.filename,
      mimeType: assetTable.mimeType,
      size: assetTable.size,
      kind: assetTable.kind,
      createdAt: assetTable.createdAt,
      creatorId: userTable.id,
      creatorName: userTable.name,
      creatorImage: userTable.image,
    })
    .from(assetTable)
    .leftJoin(userTable, eq(userTable.id, assetTable.createdBy))
    .where(where)
    .orderBy(desc(assetTable.createdAt), desc(assetTable.id));
}

export type AttachmentRow = Awaited<
  ReturnType<typeof selectAttachments>
>[number];

/** The public shape; `apiBaseUrl` already ends in /api. */
export function toTaskAttachment(row: AttachmentRow, apiBaseUrl: string) {
  const url = `${apiBaseUrl}/asset/${row.id}`;
  return {
    id: row.id,
    taskId: row.taskId ?? "",
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind === "image" ? ("image" as const) : ("attachment" as const),
    url,
    downloadUrl: `${url}?download=1`,
    createdBy:
      row.creatorId && row.creatorName !== null
        ? { id: row.creatorId, name: row.creatorName, image: row.creatorImage }
        : null,
    createdAt: row.createdAt,
  };
}

export async function countAttachments(taskId: string, reader: Reader = db) {
  const [row] = await reader
    .select({ total: count() })
    .from(assetTable)
    .where(isTaskAttachment(taskId));
  return Number(row?.total ?? 0);
}

export const ATTACHMENT_CAP_MESSAGE = `A task can have at most ${MAX_TASK_ATTACHMENTS} attachments`;

export function isBelowAttachmentCap(total: number) {
  return total < MAX_TASK_ATTACHMENTS;
}

export function assertBelowAttachmentCap(total: number) {
  if (!isBelowAttachmentCap(total)) {
    throw new HTTPException(400, { message: ATTACHMENT_CAP_MESSAGE });
  }
}

/** Where the task's files live: its workspace and current project. */
export async function loadAttachmentTaskContext(taskId: string) {
  const [context] = await db
    .select({
      taskId: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!context) throw new HTTPException(404, { message: "Task not found" });
  return context;
}
