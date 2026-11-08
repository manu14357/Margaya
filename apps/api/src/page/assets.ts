import { eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { assetTable } from "../database/schema";
import { handOverAssets } from "../storage/asset-handover";
import { deleteS3Keys } from "../storage/cleanup-assets";
import {
  assertPageAssetKeyMatchesContext,
  assertStorageConfigured,
  createPageAssetUploadUrl,
  InvalidUploadedAssetError,
  isImageContentType,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
} from "../storage/s3";
import { recordPendingUpload } from "../storage/upload-sweep";
import type { PageRecord } from "./controllers/shared";

// Files uploaded into a page (§3.2 #20-21, §3.7). Rows carry `pageId`, the
// page's project and surface "page"; `taskId` stays null.

type UploadPage = Pick<PageRecord, "id" | "workspaceId" | "projectId">;

function projectOf(page: UploadPage): string {
  if (!page.projectId) {
    throw new HTTPException(400, {
      message: "Pages without a project can't hold files yet",
    });
  }
  return page.projectId;
}

function assertUploadInput(contentType: string, size: number) {
  try {
    validateTaskAssetUploadInput(contentType, size);
  } catch (error) {
    throw new HTTPException(400, {
      message:
        error instanceof Error ? error.message : "Invalid upload request",
    });
  }
}

export async function createPageAssetUpload(
  page: UploadPage,
  input: { filename: string; contentType: string; size: number },
) {
  assertUploadInput(input.contentType, input.size);
  try {
    const upload = await createPageAssetUploadUrl({
      workspaceId: page.workspaceId,
      projectId: projectOf(page),
      pageId: page.id,
      ...input,
    });
    await recordPendingUpload(upload.key);
    return upload;
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error
          ? error.message
          : "File uploads are not configured",
    });
  }
}

export async function finalizePageAssetUpload(
  page: UploadPage,
  input: { key: string; filename: string; contentType: string; size: number },
  userId: string,
  apiBaseUrl: string,
) {
  assertUploadInput(input.contentType, input.size);
  try {
    assertStorageConfigured();
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error
          ? error.message
          : "File uploads are not configured",
    });
  }

  const projectId = projectOf(page);
  const key = input.key.trim();
  if (
    !assertPageAssetKeyMatchesContext(key, {
      workspaceId: page.workspaceId,
      projectId,
      pageId: page.id,
    })
  ) {
    throw new HTTPException(400, {
      message: "The upload key does not belong to this page.",
    });
  }

  let uploaded: Awaited<ReturnType<typeof verifyTaskAssetUpload>>;
  try {
    uploaded = await verifyTaskAssetUpload(key, {
      size: input.size,
      contentType: input.contentType,
    });
  } catch (error) {
    const invalid = error instanceof InvalidUploadedAssetError;
    throw new HTTPException(invalid ? 400 : 503, {
      message: invalid ? error.message : "Unable to verify uploaded object.",
    });
  }

  const values = {
    workspaceId: page.workspaceId,
    projectId,
    taskId: null,
    pageId: page.id,
    filename: input.filename,
    mimeType: uploaded.contentType,
    size: uploaded.size,
    kind: isImageContentType(uploaded.contentType) ? "image" : "attachment",
    surface: "page",
    createdBy: userId,
  };
  const [asset] = await db
    .insert(assetTable)
    .values({ ...values, objectKey: key })
    .onConflictDoUpdate({ target: assetTable.objectKey, set: values })
    .returning({ id: assetTable.id });
  if (!asset)
    throw new HTTPException(500, { message: "Failed to save the file" });

  return { id: asset.id, url: `${apiBaseUrl}/asset/${asset.id}` };
}

/** Assets of a page, read before the page is deleted (the FK nulls `pageId`). */
export async function pageAssets(pageId: string) {
  return db
    .select({
      id: assetTable.id,
      objectKey: assetTable.objectKey,
      workspaceId: assetTable.workspaceId,
      projectId: assetTable.projectId,
    })
    .from(assetTable)
    .where(eq(assetTable.pageId, pageId));
}

/**
 * After a page delete (§3.7): an asset other text of the workspace still
 * links (a duplicate page, a task's description or comment) is handed to it,
 * as for tasks (storage/asset-handover.ts); the rest are deleted from storage
 * and the database.
 */
export async function cleanUpDeletedPageAssets(
  page: Pick<PageRecord, "id">,
  assets: Awaited<ReturnType<typeof pageAssets>>,
) {
  const toDelete = await handOverAssets(assets, { pageIds: [page.id] });
  if (toDelete.length === 0) return;
  const results = await deleteS3Keys(toDelete.map((asset) => asset.objectKey));
  const deleted = toDelete
    .filter((_, index) => results[index]?.status === "fulfilled")
    .map((asset) => asset.id);
  if (deleted.length > 0) {
    await db.delete(assetTable).where(inArray(assetTable.id, deleted));
  }
}
