import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { taskExportFormatSchema } from "./schema";
import { TASK_EXPORT_STATUSES } from "./types";

export const taskExportStatusSchema = z.enum(TASK_EXPORT_STATUSES).openapi({
  description:
    "queued, processing, completed (ready to download), failed (see error) or expired (the file was deleted).",
});

export const taskExportSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    format: taskExportFormatSchema,
    projectIds: z.array(z.string()).openapi({
      description: "The exported projects, in export order.",
    }),
    projects: z
      .array(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
      .openapi({ description: "The projects that still exist." }),
    splitByProject: z.boolean(),
    includeArchived: z.boolean(),
    status: taskExportStatusSchema,
    error: z.string().nullable().openapi({
      description: "Why the export failed, safe to show; null otherwise.",
    }),
    taskCount: z.number().int().nullable(),
    fileName: z.string().nullable(),
    contentType: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    requestedBy: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    createdAt: responseTimestamp,
    startedAt: nullableResponseTimestamp,
    completedAt: nullableResponseTimestamp,
    expiresAt: nullableResponseTimestamp.openapi({
      description: "When the file is deleted; set once completed.",
    }),
    downloadable: z.boolean().openapi({
      description: "Completed and not expired yet.",
    }),
  })
  .openapi("TaskExport", {
    description:
      "An asynchronous task export. The file is built in the background and can be downloaded for a few days (EXPORT_RETENTION_DAYS, default 7).",
  });

export const taskExportPageSchema = z
  .object({
    items: z.array(taskExportSchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next page; null on the last page.",
    }),
  })
  .openapi("TaskExportPage");

export const taskExportDeletedSchema = z
  .object({ id: z.string() })
  .openapi("TaskExportDeleted");

export type TaskExportResponse = z.infer<typeof taskExportSchema>;
