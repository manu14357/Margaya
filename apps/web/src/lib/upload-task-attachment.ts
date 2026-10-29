import createTaskAttachmentUpload from "@/fetchers/task-attachment/create-task-attachment-upload";
import finalizeTaskAttachment from "@/fetchers/task-attachment/finalize-task-attachment";

/** The browser's PUT to storage failed (not an API answer). */
export class StorageUploadError extends Error {
  constructor(public status: number) {
    super(`Storage rejected the upload (${status})`);
    this.name = "StorageUploadError";
  }
}

/**
 * Attaches one file to a task's Attachments panel in the same three steps as
 * inline task images: ask the API for a presigned PUT, send the bytes to
 * storage, then finalize. Returns the recorded attachment.
 */
export async function uploadTaskAttachment({
  taskId,
  file,
}: {
  taskId: string;
  file: File;
}) {
  const filename = file.name || "file";
  const contentType = file.type || "application/octet-stream";

  const upload = await createTaskAttachmentUpload(taskId, {
    filename,
    contentType,
    size: file.size,
  });

  // Presigned storage URL, not an API route: the client would add JSON headers.
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new StorageUploadError(response.status);
  }

  return finalizeTaskAttachment(taskId, {
    key: upload.key,
    filename,
    contentType,
    size: file.size,
  });
}
