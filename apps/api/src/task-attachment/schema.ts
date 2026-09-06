import { z } from "../openapi";

export const taskIdParam = z.object({ taskId: z.string() });

export const taskAttachmentParam = z.object({
  taskId: z.string(),
  attachmentId: z.string(),
});

const filename = z.string().min(1).max(1000).openapi({
  description:
    "The file's name. Control characters and path separators are removed and it is cut to 255 characters, keeping the extension.",
});

const contentType = z.string().max(255).openapi({
  description:
    "The file's MIME type; any type is accepted, and empty means application/octet-stream. Only safe image types are ever shown inline.",
});

const size = z.number().int().openapi({
  description:
    "The file size in bytes, at most S3_MAX_IMAGE_UPLOAD_BYTES (10 MB by default).",
});

export const createAttachmentUploadBody = z.object({
  filename,
  contentType,
  size,
});

export const finalizeAttachmentBody = z.object({
  key: z.string().max(1024).openapi({
    description: "The key returned by the upload route.",
  }),
  filename,
  contentType,
  size,
});
