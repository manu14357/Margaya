import { z } from "../openapi";
import { MAX_EXPORT_PROJECT_IDS, TASK_EXPORT_FORMATS } from "./types";

export const taskExportFormatSchema = z.enum(TASK_EXPORT_FORMATS).openapi({
  description: "csv, xlsx (Excel) or json.",
});

export const createTaskExportBody = z.object({
  workspaceId: z.string().min(1),
  format: taskExportFormatSchema,
  projectIds: z
    .array(z.string().min(1))
    .max(MAX_EXPORT_PROJECT_IDS)
    .optional()
    .openapi({
      description:
        "Projects to export (archived ones allowed). Absent or empty means every non-archived project of the workspace, in project order.",
    }),
  splitByProject: z.boolean().optional().default(false).openapi({
    description:
      "One sheet per project (xlsx) or one file per project in a ZIP (csv, json). Ignored for a single project.",
  }),
  includeArchived: z.boolean().optional().default(true).openapi({
    description: "Include archived tasks; they carry an Archived at value.",
  }),
});

export const createWorkspaceExportBody = z.object({
  workspaceId: z.string().min(1),
  includeFiles: z.boolean().optional().default(true).openapi({
    description:
      "Put stored files in the archive. Without them it still lists every file in files/index.json.",
  }),
});

export const listTaskExportsQuery = z.object({
  workspaceId: z.string().min(1),
  scope: z.enum(["mine", "all"]).optional().default("mine").openapi({
    description:
      "mine: the caller's exports. all: everyone's, for workspace:manage_settings holders.",
  }),
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const taskExportParam = z.object({ id: z.string() });
