import { responseTimestamp, z } from "../openapi";
import { REPORT_VISIBILITIES, reportConfigSchema } from "./schema";

export const analyticsReportSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    visibility: z.enum(REPORT_VISIBILITIES),
    owner: z.object({ id: z.string(), name: z.string() }).nullable(),
    isOwner: z.boolean(),
    canDelete: z.boolean().openapi({
      description:
        "The owner, or for workspace reports someone with workspace:manage_settings.",
    }),
    config: reportConfigSchema,
    droppedProjectCount: z.number().int().openapi({
      description:
        "Scope projects left out because they are gone, in the trash or not in this workspace. When every one is gone the scope falls back to the whole workspace.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AnalyticsReport", {
    description:
      "A saved chart-builder configuration. The scope is checked against the workspace each time it is read; the chart itself runs with the viewer's permissions.",
  });

export const analyticsReportListSchema = z.array(analyticsReportSchema);

export const deletedReportSchema = z
  .object({ id: z.string() })
  .openapi("DeletedAnalyticsReport");
