import { columnGroupSchema } from "../column/response";
import { nullableResponseTimestamp, z } from "../openapi";

export const projectAutomationsSchema = z
  .object({
    projectId: z.string(),
    autoArchive: z.object({
      enabled: z.boolean(),
      months: z.number().int(),
      lastArchivedAt: nullableResponseTimestamp,
      lastArchivedCount: z.number().int(),
    }),
    autoClose: z.object({
      enabled: z.boolean(),
      months: z.number().int(),
      columnId: z.string().nullable(),
      column: z
        .object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          icon: z.string().nullable(),
          group: columnGroupSchema,
        })
        .nullable(),
      state: z.enum(["off", "active", "paused"]),
      pausedReason: z.enum(["no_column", "column_not_cancelled"]).nullable(),
      lastClosedAt: nullableResponseTimestamp,
      lastClosedCount: z.number().int(),
    }),
    lastCheckedAt: nullableResponseTimestamp,
    updatedAt: nullableResponseTimestamp.openapi({
      description:
        "When the settings last changed; null before the first change.",
    }),
    updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .openapi("ProjectAutomations", {
    description:
      "Scheduled automations of a project, checked every hour. Auto-close is paused while its column is missing or no longer in the Cancelled group.",
  });

export const automationPreviewSchema = z
  .object({
    rule: z.enum(["archive", "close"]),
    months: z.number().int(),
    count: z.number().int().openapi({
      description: "Tasks the rule would take right now, at most 10,000.",
    }),
    capped: z.boolean().openapi({ description: "True when more tasks match." }),
  })
  .openapi("AutomationPreview");
