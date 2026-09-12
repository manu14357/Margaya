import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { assetTable } from "../database/schema";
import { deleteS3Keys, extractAssetIds } from "../storage/cleanup-assets";
import {
  buildStorageObjectKey,
  copyS3Object,
  type UploadSurface,
} from "../storage/s3";

export const MAX_COPIED_DESCRIPTION_IMAGES = 50;
const COPY_CONCURRENCY = 4;
export const FILES_COPY_FAILED =
  "Couldn't copy the task's files. Try again, or copy without files.";

export type FileCopy = {
  sourceAssetId: string;
  newAssetId: string;
  sourceKey: string;
  destinationKey: string;
  surface: UploadSurface;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
};

type Destination = { workspaceId: string; projectId: string; taskId: string };

/**
 * The files a copy duplicates: the source task's own description images
 * (asset URLs of other tasks stay as they are) and, when asked, its panel
 * attachments. Each gets a new asset id and a key under the copy.
 */
export async function planFileCopies({
  sourceTaskId,
  description,
  includeAttachments,
  destination,
}: {
  sourceTaskId: string;
  description: string | null;
  includeAttachments: boolean;
  destination: Destination;
}): Promise<FileCopy[]> {
  const imageIds = [...extractAssetIds(description)];
  const images = imageIds.length
    ? await db
        .select()
        .from(assetTable)
        .where(
          and(
            inArray(assetTable.id, imageIds),
            eq(assetTable.taskId, sourceTaskId),
            eq(assetTable.surface, "description"),
          ),
        )
    : [];
  if (images.length > MAX_COPIED_DESCRIPTION_IMAGES) {
    throw new HTTPException(400, {
      message: "This task has too many images to copy",
    });
  }

  const attachments = includeAttachments
    ? await db
        .select()
        .from(assetTable)
        .where(
          and(
            eq(assetTable.taskId, sourceTaskId),
            eq(assetTable.surface, "attachment"),
          ),
        )
        .orderBy(asc(assetTable.createdAt), asc(assetTable.id))
    : [];

  const assets = [...images, ...attachments];
  if (assets.length === 0) return [];

  try {
    return assets.map((asset) => ({
      sourceAssetId: asset.id,
      newAssetId: createId(),
      sourceKey: asset.objectKey,
      destinationKey: buildStorageObjectKey({
        ...destination,
        surface: asset.surface === "attachment" ? "attachment" : "description",
        filename: asset.filename,
        contentType: asset.mimeType,
      }),
      surface: asset.surface === "attachment" ? "attachment" : "description",
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size,
      kind: asset.kind,
    }));
  } catch {
    // Storage is not configured, but the task has files.
    throw new HTTPException(503, { message: FILES_COPY_FAILED });
  }
}

/**
 * Copies the objects server-side, at most four at a time. When one fails,
 * the objects already copied are deleted (best effort) and the copy is
 * refused with a 503.
 */
export async function copyStoredFiles(copies: readonly FileCopy[]) {
  const copied: string[] = [];
  let failed = false;
  let next = 0;

  async function worker() {
    while (!failed && next < copies.length) {
      const copy = copies[next++];
      if (!copy) return;
      try {
        await copyS3Object(copy.sourceKey, copy.destinationKey);
        copied.push(copy.destinationKey);
      } catch {
        failed = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, copies.length) }, worker),
  );
  if (failed) {
    await deleteS3Keys(copied);
    throw new HTTPException(503, { message: FILES_COPY_FAILED });
  }
}

/** Removes duplicated objects after the database write failed. */
export async function discardCopiedFiles(copies: readonly FileCopy[]) {
  if (copies.length === 0) return;
  await deleteS3Keys(copies.map((copy) => copy.destinationKey));
}
