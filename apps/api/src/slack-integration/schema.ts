import { integrationEventToggles } from "../integrations/schema";
import { z } from "../openapi";

// Slack also posts due date changes and intake decisions (both off by
// default); the other chat integrations keep the shared six toggles.
export const slackEventToggles = integrationEventToggles.extend({
  taskDueDateChanged: z.boolean().optional(),
  projectUpdate: z.boolean().optional().openapi({
    description: "A project status update was posted.",
  }),
  intakeDecision: z.boolean().optional().openapi({
    description:
      "An intake request was accepted, declined or closed as a duplicate.",
  }),
});

export const createSlackBody = z.object({
  webhookUrl: z.string().min(1),
  channelName: z.string().optional(),
  events: slackEventToggles.optional(),
});

export const updateSlackBody = z.object({
  webhookUrl: z.string().optional(),
  channelName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  events: slackEventToggles.optional(),
});
