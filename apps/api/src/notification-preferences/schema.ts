import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

// Secrets are write-only: a value sets it, null clears it, omitting leaves it.
// URLs and the topic work the same way; "" clears them too.
export const updatePreferencesBody = z.object({
  emailEnabled: z.boolean().optional(),
  ntfyEnabled: z.boolean().optional(),
  ntfyServerUrl: z.string().nullable().optional(),
  ntfyTopic: z.string().nullable().optional(),
  ntfyToken: z.string().nullable().optional(),
  gotifyEnabled: z.boolean().optional(),
  gotifyServerUrl: z.string().nullable().optional(),
  gotifyToken: z.string().nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().nullable().optional().openapi({
    description:
      "null or an empty string removes the URL; the webhook channel must then be disabled.",
  }),
  webhookSecret: z.string().nullable().optional(),
  taskAssignmentEnabled: z.boolean().optional(),
  taskCommentEnabled: z.boolean().optional(),
  taskStatusChangeEnabled: z.boolean().optional(),
  taskUpdateEnabled: z.boolean().optional().openapi({
    description:
      "Priority, due date and title changes on tasks you are assigned to or subscribed to.",
  }),
  dueDateReminderEnabled: z.boolean().optional(),
  dueDateReminderLeadTimeMinutes: z
    .number()
    .int()
    .min(5)
    .max(43_200)
    .optional()
    .openapi({ description: "Between 5 minutes and 30 days." }),
  digestFrequency: z.enum(["off", "daily", "weekly"]).optional().openapi({
    description:
      "An optional summary email of due tasks, new mentions and unread inbox items.",
  }),
  digestWeekday: z.number().int().min(0).max(6).optional().openapi({
    description: "The weekly digest's day, 0 = Sunday to 6 = Saturday.",
  }),
  digestHour: z.number().int().min(0).max(23).optional().openapi({
    description: "The local hour (0-23, in your time zone) digests are sent.",
  }),
});

export const upsertWorkspaceRuleBody = z.object({
  isActive: z.boolean(),
  emailEnabled: z.boolean(),
  ntfyEnabled: z.boolean(),
  gotifyEnabled: z.boolean(),
  webhookEnabled: z.boolean(),
  projectMode: z.enum(["all", "selected"]),
  selectedProjectIds: z.array(z.string()).optional().openapi({
    description: "Required in practice when projectMode is `selected`.",
  }),
});
