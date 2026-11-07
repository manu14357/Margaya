import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { PAGE_ACCESS, PAGE_LOGO_KINDS } from "../page/types";

const deletedByShape = {
  deletedAt: responseTimestamp.openapi({ description: "When it was deleted." }),
  deletedBy: z.object({ id: z.string(), name: z.string() }).nullable().openapi({
    description: "Who deleted it; null for a deleted user account.",
  }),
  purgeAt: nullableResponseTimestamp.openapi({
    description:
      "When the auto purge deletes it permanently; null when TRASH_RETENTION_DAYS is 0.",
  }),
};

export const trashedTaskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    number: z.number().nullable(),
    key: z.string().openapi({ description: "{projectSlug}-{number}." }),
    title: z.string(),
    status: z.string().openapi({
      description:
        "The column slug the task had. A restore lands there, or in the project's entry column when that column is gone.",
    }),
    priority: z.string(),
    subTaskCount: z.number().int().openapi({
      description:
        "Sub-tasks deleted together with it; a restore or permanent delete includes them.",
    }),
    ...deletedByShape,
  })
  .openapi("TrashedTask");

export const trashedTaskListSchema = z
  .object({
    items: z.array(trashedTaskSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("TrashedTaskList");

export const trashedProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    icon: z.string().nullable(),
    taskCount: z.number().int().openapi({
      description: "Tasks deleted together with the project.",
    }),
    ...deletedByShape,
  })
  .openapi("TrashedProject");

export const trashedProjectListSchema = z
  .object({
    items: z.array(trashedProjectSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("TrashedProjectList");

export const trashedPageSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    title: z.string().openapi({ description: "May be empty (Untitled)." }),
    logoKind: z.enum(PAGE_LOGO_KINDS).nullable(),
    logoValue: z.string().nullable(),
    access: z.enum(PAGE_ACCESS),
    canManage: z.boolean().openapi({
      description:
        "The caller may restore it or delete it permanently: its owner with page:update, or page:delete.",
    }),
    ...deletedByShape,
  })
  .openapi("TrashedPage");

export const trashedPageListSchema = z
  .object({
    items: z.array(trashedPageSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("TrashedPageList");

export const emptyTrashResultSchema = z
  .object({
    deletedCount: z.number().int().openapi({
      description: "Tasks deleted permanently, sub-tasks included.",
    }),
  })
  .openapi("EmptyTrashResult");
