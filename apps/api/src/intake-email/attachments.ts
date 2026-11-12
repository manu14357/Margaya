import db from "../database";
import { assetTable } from "../database/schema";
import {
  assertStorageConfigured,
  buildObjectKey,
  buildPrivateObjectKey,
  isImageContentType,
  putPrivateObject,
  storageDriver,
} from "../storage/s3";
import {
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "../task-attachment/filename";
import {
  ATTACHMENT_SURFACE,
  countAttachments,
  MAX_TASK_ATTACHMENTS,
} from "../task-attachment/queries";
import type { IntakeEmailLimits } from "./config";
import type { MailAttachment } from "./mime";

// Keeps an email's files as task attachments (#8). Files are not scanned
// for malware (none of Margaya's uploads are); the size and count limits
// bound what a sender can store.

export type SkippedAttachment = {
  filename: string;
  reason: "too_large" | "too_many" | "storage_off" | "store_failed";
};

export type StoredAttachment = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
};

/**
 * The attachments within the limits, in message order, and the files left
 * out with the reason.
 */
export function selectAttachments(
  attachments: readonly MailAttachment[],
  limits: IntakeEmailLimits,
  existing: number,
): { keep: MailAttachment[]; skipped: SkippedAttachment[] } {
  const keep: MailAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const room = Math.max(
    0,
    Math.min(limits.maxAttachments, MAX_TASK_ATTACHMENTS - existing),
  );
  for (const attachment of attachments) {
    const filename = sanitizeAttachmentFilename(attachment.filename);
    if (attachment.content.byteLength === 0) continue;
    if (attachment.content.byteLength > limits.maxAttachmentBytes) {
      skipped.push({ filename, reason: "too_large" });
    } else if (keep.length >= room) {
      skipped.push({ filename, reason: "too_many" });
    } else {
      keep.push({ ...attachment, filename });
    }
  }
  return { keep, skipped };
}

function storageAvailable(): boolean {
  if (storageDriver() === "none") return false;
  try {
    assertStorageConfigured();
    return true;
  } catch {
    return false;
  }
}

/** Stores the files that fit as attachments of the task. */
export async function storeEmailAttachments({
  workspaceId,
  projectId,
  taskId,
  attachments,
  limits,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  attachments: readonly MailAttachment[];
  limits: IntakeEmailLimits;
}): Promise<{ stored: StoredAttachment[]; skipped: SkippedAttachment[] }> {
  if (attachments.length === 0) return { stored: [], skipped: [] };
  if (!storageAvailable()) {
    return {
      stored: [],
      skipped: attachments.map((attachment) => ({
        filename: sanitizeAttachmentFilename(attachment.filename),
        reason: "storage_off" as const,
      })),
    };
  }

  const { keep, skipped } = selectAttachments(
    attachments,
    limits,
    await countAttachments(taskId),
  );
  const stored: StoredAttachment[] = [];
  for (const attachment of keep) {
    const contentType = normalizeAttachmentContentType(attachment.contentType);
    const objectKey = buildPrivateObjectKey(
      buildObjectKey({
        workspaceId,
        projectId,
        taskId,
        surface: ATTACHMENT_SURFACE,
        filename: attachment.filename,
        contentType,
      }),
    );
    try {
      await putPrivateObject(objectKey, attachment.content, contentType);
      const [row] = await db
        .insert(assetTable)
        .values({
          workspaceId,
          projectId,
          taskId,
          objectKey,
          filename: attachment.filename,
          mimeType: contentType,
          size: attachment.content.byteLength,
          kind: isImageContentType(contentType) ? "image" : "attachment",
          surface: ATTACHMENT_SURFACE,
          createdBy: null,
        })
        .returning({ id: assetTable.id });
      if (row) {
        stored.push({
          id: row.id,
          filename: attachment.filename,
          size: attachment.content.byteLength,
          mimeType: contentType,
        });
      }
    } catch (error) {
      console.error("Failed to store an email attachment", error);
      skipped.push({ filename: attachment.filename, reason: "store_failed" });
    }
  }
  return { stored, skipped };
}
