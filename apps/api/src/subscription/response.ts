import { z } from "../openapi";
import { SUBSCRIPTION_REASONS } from "./service";

export const taskSubscriptionSchema = z
  .object({
    taskId: z.string(),
    subscribed: z.boolean().openapi({
      description:
        "The effective state: a subscription, or an assignment the caller has not unsubscribed from.",
    }),
    reason: z.enum(SUBSCRIPTION_REASONS).nullable().openapi({
      description:
        "Why the caller is subscribed (creator, assignee, commenter, mention or manual); null when not subscribed.",
    }),
    isAssignee: z.boolean(),
    isMuted: z.boolean().openapi({
      description:
        "The caller explicitly unsubscribed. Mentions and new assignments still notify, and subscribe again.",
    }),
    subscriberCount: z.number().int().openapi({
      description:
        "Distinct watchers: subscribed users plus assignees, minus those who unsubscribed.",
    }),
  })
  .openapi("TaskSubscription");
