import { z } from "../openapi";

export const automationProjectParam = z.object({ projectId: z.string() });

const months = z.number().int().min(1).max(12).openapi({
  description: "Whole calendar months without updates, 1-12.",
});

export const updateProjectAutomationsBody = z
  .object({
    autoArchive: z
      .object({ enabled: z.boolean().optional(), months: months.optional() })
      .strict()
      .optional(),
    autoClose: z
      .object({
        enabled: z.boolean().optional(),
        months: months.optional(),
        columnId: z.string().min(1).nullable().optional().openapi({
          description:
            "A column of this project in the Cancelled group; closed tasks move there.",
        }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .openapi("UpdateProjectAutomationsBody", {
    description:
      "Send at least one setting. Turning a rule off keeps its months and column.",
  });

export const AUTOMATION_RULES = ["archive", "close"] as const;

export const automationPreviewQuery = z.object({
  rule: z.enum(AUTOMATION_RULES),
  months: z.coerce.number().int().min(1).max(12),
});
