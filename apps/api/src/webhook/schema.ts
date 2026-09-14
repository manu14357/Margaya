import { z } from "../openapi";
import {
  MAX_GRACE_HOURS,
  MAX_WEBHOOK_NAME_LENGTH,
  MAX_WEBHOOK_PATTERNS,
  MAX_WEBHOOK_URL_LENGTH,
  WEBHOOK_DELIVERY_STATUSES,
} from "./types";

const nameField = z
  .string()
  .trim()
  .max(MAX_WEBHOOK_NAME_LENGTH)
  .nullable()
  .openapi({
    description:
      "Shown instead of the URL's host. Trimmed; empty or null clears it.",
  });

const urlField = z.string().max(MAX_WEBHOOK_URL_LENGTH).openapi({
  description:
    "An absolute http or https URL without credentials that resolves to a public address. Normalized: lower-case scheme and host, no fragment, no default port.",
  example: "https://example.com/webhooks/margaya",
});

const eventsField = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(MAX_WEBHOOK_PATTERNS)
  .openapi({
    description:
      'Subscription patterns: "*" (every event, including ones added later), "<family>.*" (a whole family such as "task.*") or exact event names from GET /webhook/events. Stored deduplicated and sorted.',
    example: ["task.*", "comment.created"],
  });

export const listWebhooksQuery = z.object({
  workspaceId: z.string().min(1),
});

export const createWebhookBody = z.object({
  workspaceId: z.string().min(1),
  name: nameField.optional(),
  url: urlField,
  events: eventsField.optional().default(["*"]),
  isActive: z.boolean().optional().default(true),
});

export const updateWebhookBody = z
  .object({
    name: nameField.optional(),
    url: urlField.optional(),
    events: eventsField.optional(),
    isActive: z.boolean().optional().openapi({
      description:
        "false pauses the webhook and cancels its pending deliveries; true enables it again and resets its failure streak.",
    }),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one of name, url, events or isActive",
  });

export const rotateWebhookSecretBody = z.object({
  graceHours: z
    .number()
    .int()
    .min(0)
    .max(MAX_GRACE_HOURS)
    .optional()
    .default(24)
    .openapi({
      description:
        "Hours the previous secret stays valid (0–72, default 24). Both signatures are sent meanwhile; 0 drops it at once.",
    }),
});

export const webhookParam = z.object({ id: z.string() });

export const webhookDeliveryParam = z.object({
  id: z.string(),
  deliveryId: z.string(),
});

const statusFilter = z
  .string()
  .max(200)
  .refine(
    (value) =>
      value
        .split(",")
        .every((part) =>
          (WEBHOOK_DELIVERY_STATUSES as readonly string[]).includes(
            part.trim(),
          ),
        ),
    { message: "Unknown delivery status" },
  )
  .openapi({
    description:
      "Comma-separated statuses: pending, sending, succeeded, failed, cancelled.",
    example: "failed,cancelled",
  });

export const listWebhookDeliveriesQuery = z.object({
  status: statusFilter.optional(),
  event: z.string().min(1).max(100).optional().openapi({
    description: "An exact public event name.",
  }),
  cursor: z.string().max(512).optional().openapi({
    description: "The nextCursor of the previous page.",
  }),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type CreateWebhookInput = z.infer<typeof createWebhookBody>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookBody>;
export type ListWebhookDeliveriesInput = z.infer<
  typeof listWebhookDeliveriesQuery
>;
