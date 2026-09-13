import { z } from "../openapi";

export const DEFAULT_TRASH_PAGE_SIZE = 50;

export const trashedTaskParam = z.object({
  taskId: z.string().min(1).openapi({ description: "A trashed task's id." }),
});

export const trashProjectParam = z.object({
  projectId: z.string().min(1).openapi({ description: "The project's id." }),
});

export const trashWorkspaceQuery = z.object({
  workspaceId: z.string().min(1),
});

export const listTrashQuery = z.object({
  search: z.string().trim().max(100).optional().openapi({
    description:
      "Title (tasks) or name (projects) contains this text, ignoring case; a task key such as ABC-12 or a number also matches.",
  }),
  page: z.coerce.number().int().min(1).optional().openapi({
    description: "1-based page number (default 1).",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: "Page size, 1-100 (default 50)." }),
});

export const listProjectTrashQuery = listTrashQuery.extend(
  trashWorkspaceQuery.shape,
);
