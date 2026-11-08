import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// Secrets are never returned: each is a *Configured boolean plus a masked preview.
export const workspaceRuleSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    isActive: z.boolean().openapi({
      description: "Turn all notifications for this workspace on or off.",
    }),
    emailEnabled: z.boolean(),
    ntfyEnabled: z.boolean(),
    gotifyEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    pushEnabled: z.boolean().openapi({
      description:
        "Whether your devices get push for this workspace. A workspace with no rule does.",
    }),
    projectMode: z.enum(["all", "selected"]).openapi({
      description:
        "`all` notifies for every project in the workspace; `selected` restricts it to selectedProjectIds.",
    }),
    selectedProjectIds: z.array(z.string()),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("NotificationPreferenceWorkspaceRule");

// A device's encryption keys are never returned.
const pushDeviceSchema = z
  .object({
    id: z.string(),
    endpoint: z.string().openapi({
      description: "Lets a browser recognize its own entry in the list.",
    }),
    userAgent: z.string().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("PushDevice");

export const pushStatusSchema = z
  .object({
    available: z.boolean().openapi({
      description:
        "False until the instance sets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    }),
    publicKey: z.string().nullable().openapi({
      description: "The key browsers subscribe with, when push is available.",
    }),
    subscriptions: z.array(pushDeviceSchema),
  })
  .openapi("PushStatus");

export const notificationPreferenceSchema = z
  .object({
    emailAddress: z.string().nullable(),
    emailEnabled: z.boolean(),
    ntfyEnabled: z.boolean(),
    ntfyConfigured: z.boolean(),
    ntfyServerUrl: z.string().nullable(),
    ntfyTopic: z.string().nullable(),
    ntfyTokenConfigured: z.boolean(),
    maskedNtfyToken: z.string().nullable(),
    gotifyEnabled: z.boolean(),
    gotifyConfigured: z.boolean(),
    gotifyServerUrl: z.string().nullable(),
    gotifyTokenConfigured: z.boolean(),
    maskedGotifyToken: z.string().nullable(),
    webhookEnabled: z.boolean(),
    webhookConfigured: z.boolean(),
    webhookUrl: z.string().nullable(),
    webhookSecretConfigured: z.boolean(),
    maskedWebhookSecret: z.string().nullable(),
    taskAssignmentEnabled: z.boolean(),
    taskCommentEnabled: z.boolean(),
    taskStatusChangeEnabled: z.boolean(),
    taskUpdateEnabled: z.boolean().openapi({
      description:
        "Priority, due date and title changes on tasks you are assigned to or subscribed to.",
    }),
    dueDateReminderEnabled: z.boolean(),
    dueDateReminderLeadTimeMinutes: z.number().openapi({
      description: "How long before a due date the reminder fires, in minutes.",
    }),
    digestFrequency: z.enum(["off", "daily", "weekly"]).openapi({
      description:
        "The optional summary email: `off` (default), `daily` or `weekly`.",
    }),
    digestWeekday: z.number().openapi({
      description: "The weekly digest's day, 0 = Sunday to 6 = Saturday.",
    }),
    digestHour: z.number().openapi({
      description: "The local hour (0-23) digests are sent.",
    }),
    lastDigestSentAt: nullableResponseTimestamp.openapi({
      description: "When the last digest period was handled.",
    }),
    workspaces: z.array(workspaceRuleSchema).openapi({
      description:
        "Per-workspace overrides. A workspace with no rule follows the global settings.",
    }),
    createdAt: nullableResponseTimestamp,
    updatedAt: nullableResponseTimestamp,
  })
  .openapi("NotificationPreferences");
