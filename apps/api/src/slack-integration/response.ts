import { integrationEventsSchema } from "../integrations/response";
import { responseTimestamp, z } from "../openapi";

export const slackEventsSchema = integrationEventsSchema
  .extend({
    taskDueDateChanged: z.boolean(),
    intakeDecision: z.boolean(),
    projectUpdate: z.boolean(),
  })
  .openapi("SlackEvents");

// The webhook URL is a bearer credential, so only a masked form is returned.
export const slackIntegrationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    channelName: z.string().nullable(),
    webhookConfigured: z.boolean(),
    maskedWebhookUrl: z.string().openapi({
      description:
        "The webhook URL with its secret path segment masked, or an empty string when none is set.",
    }),
    events: slackEventsSchema,
    isActive: z.boolean().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SlackIntegration");
