import { z } from "../openapi";

export const ARCHIVED_ENTITY_TYPES = ["cycle", "module", "project"] as const;
export type ArchivedEntityType = (typeof ARCHIVED_ENTITY_TYPES)[number];

export const DEFAULT_ARCHIVE_PAGE_SIZE = 50;

const scopeProjectId = z.string().min(1).optional().openapi({
  description:
    "One project (archived ones included). Without it, the workspace's projects that are not archived.",
});

export const archiveSummaryQuery = z.object({
  workspaceId: z.string(),
  projectId: scopeProjectId,
});

export const archivedTypeParam = z.object({
  type: z.enum(ARCHIVED_ENTITY_TYPES),
});

export const listArchivedQuery = z.object({
  workspaceId: z.string(),
  projectId: scopeProjectId,
  search: z.string().trim().max(100).optional().openapi({
    description: "Name contains this text, ignoring case.",
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
