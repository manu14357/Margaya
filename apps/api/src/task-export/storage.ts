import { and, eq, inArray, isNotNull } from "drizzle-orm";
import db from "../database";
import { taskExportFileTable, taskExportTable } from "../database/schema";
import { deleteLocalObject, readLocalObject } from "../storage/local";
import {
  assertStorageConfigured,
  buildPrivateObjectKey,
  deleteS3Object,
  getPrivateObject,
  sanitizePathSegment,
  storageDriver,
} from "../storage/s3";
import type { TaskExportStorage } from "./types";

// Export files go to the S3-compatible storage when it is configured, else
// to Postgres (`task_export_file`), so exports work on the smallest install
// and across instances. Task exports don't use the built-in local file store:
// it is per instance, and a download may reach another one. Whole-workspace
// exports do when it is the active store: they are too large for Postgres, and
// an install on the local store already needs every instance to share it.
// Downloads always pass through the authorized API route; there are no public
// or presigned URLs.

type StoredFile = {
  id: string;
  storage: TaskExportStorage | null;
  objectKey: string | null;
};

export function isObjectStorageConfigured(): boolean {
  if (storageDriver() !== "s3") return false;
  try {
    assertStorageConfigured();
    return true;
  } catch {
    return false;
  }
}

/** `exports/{workspaceId}/{exportId}/{fileName}`, S3_KEY_PREFIX applied. */
export function exportObjectKey(
  workspaceId: string,
  exportId: string,
  fileName: string,
): string {
  return buildPrivateObjectKey(
    [
      "exports",
      sanitizePathSegment(workspaceId),
      sanitizePathSegment(exportId),
      fileName,
    ].join("/"),
  );
}

/** The stored bytes as a body to stream, with their length when known. */
export async function openExportFile(
  file: StoredFile,
): Promise<{ body: BodyInit; length: number | undefined } | null> {
  if (file.storage === "s3" && file.objectKey) {
    const object = await getPrivateObject(file.objectKey);
    return { body: object.body as BodyInit, length: object.contentLength };
  }
  if (file.storage === "local" && file.objectKey) {
    const object = await readLocalObject(file.objectKey);
    return { body: object.body as BodyInit, length: object.contentLength };
  }
  if (file.storage === "database") {
    const [row] = await db
      .select({ content: taskExportFileTable.content })
      .from(taskExportFileTable)
      .where(eq(taskExportFileTable.exportId, file.id))
      .limit(1);
    if (!row) return null;
    return {
      body: new Uint8Array(row.content) as BodyInit,
      length: row.content.byteLength,
    };
  }
  return null;
}

/** Removes the stored bytes. Throws when object storage refuses. */
export async function deleteExportFile(file: StoredFile): Promise<void> {
  if (file.storage === "s3" && file.objectKey) {
    await deleteS3Object(file.objectKey);
    return;
  }
  if (file.storage === "local" && file.objectKey) {
    await deleteLocalObject(file.objectKey);
    return;
  }
  await db
    .delete(taskExportFileTable)
    .where(eq(taskExportFileTable.exportId, file.id));
}

/** Like `deleteExportFile`, logging failures instead of throwing. */
export async function deleteExportFileQuietly(
  file: StoredFile,
): Promise<boolean> {
  try {
    await deleteExportFile(file);
    return true;
  } catch (error) {
    console.error(`exports: could not delete the file of ${file.id}`, error);
    return false;
  }
}

/**
 * Deletes a workspace's export objects before the workspace goes away; its
 * rows and database-stored files cascade with it. Best effort.
 */
export async function purgeWorkspaceExports(workspaceId: string) {
  const rows = await db
    .select({
      id: taskExportTable.id,
      storage: taskExportTable.storage,
      objectKey: taskExportTable.objectKey,
    })
    .from(taskExportTable)
    .where(
      and(
        eq(taskExportTable.workspaceId, workspaceId),
        inArray(taskExportTable.storage, ["s3", "local"]),
        isNotNull(taskExportTable.objectKey),
      ),
    );
  for (const row of rows) await deleteExportFileQuietly(row);
}
