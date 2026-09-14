import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DELIVERY_TRIGGERS,
  WEBHOOK_DISABLED_REASONS,
  WEBHOOK_ENTITY_TYPES,
} from "./types";

export const webhookSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string().nullable(),
    url: z.string(),
    events: z.array(z.string()).openapi({
      description: "Subscription patterns, deduplicated and sorted.",
    }),
    isActive: z.boolean(),
    disabledReason: z.enum(WEBHOOK_DISABLED_REASONS).nullable().openapi({
      description:
        "manual (paused by an admin) or failures (disabled by Margaya after repeated delivery failures); null while active.",
    }),
    disabledAt: nullableResponseTimestamp,
    secretHint: z.string().openapi({
      description: 'The secret\'s last 4 characters, as "whsec_…abcd".',
    }),
    secretRotatedAt: nullableResponseTimestamp,
    previousSecretExpiresAt: nullableResponseTimestamp.openapi({
      description:
        "Until when the previous secret's signature is still sent; null outside a grace period.",
    }),
    secretStatus: z.enum(["ok", "unreadable"]).openapi({
      description:
        "unreadable when the stored secret no longer opens with this instance's key (AUTH_SECRET changed). Deliveries then fail until the secret is rotated.",
    }),
    health: z.object({
      lastSuccessAt: nullableResponseTimestamp,
      lastFailureAt: nullableResponseTimestamp,
      failureStreak: z.number().int(),
      failingSince: nullableResponseTimestamp,
    }),
    createdBy: z
      .object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Webhook", {
    description:
      "A workspace webhook: signed HTTP deliveries of workspace events to an endpoint. The signing secret is never returned here.",
  });

export const webhookDetailSchema = webhookSchema
  .extend({
    pendingDeliveries: z.number().int().openapi({
      description: "Deliveries waiting to be sent or retried.",
    }),
  })
  .openapi("WebhookDetail");

export const webhookWithSecretSchema = webhookSchema
  .extend({
    secret: z.string().openapi({
      description:
        "The signing secret (whsec_…). Shown once. Store it securely.",
    }),
  })
  .openapi("WebhookWithSecret", {
    description:
      "A webhook with its signing secret, returned only on create and on rotate. Shown once. Store it securely.",
  });

const attemptSchema = z.object({
  at: z.string().openapi({ format: "date-time" }),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});

export const webhookDeliverySummarySchema = z
  .object({
    id: z.string(),
    webhookId: z.string(),
    event: z.string(),
    entityType: z.enum(WEBHOOK_ENTITY_TYPES),
    entityId: z.string().nullable(),
    projectId: z.string().nullable(),
    summary: z.string().nullable(),
    status: z.enum(WEBHOOK_DELIVERY_STATUSES),
    trigger: z.enum(WEBHOOK_DELIVERY_TRIGGERS).openapi({
      description: "event, redelivery or ping (a test).",
    }),
    redeliveryOf: z.string().nullable(),
    attemptCount: z.number().int(),
    maxAttempts: z.number().int(),
    nextAttemptAt: nullableResponseTimestamp.openapi({
      description: "Set while the delivery is pending.",
    }),
    responseStatus: z.number().int().nullable(),
    error: z.string().nullable().openapi({
      description:
        "A safe reason such as Timed out after 10 seconds, Connection failed, Destination not allowed, Redirects are not followed or Signing secret unavailable.",
    }),
    durationMs: z.number().int().nullable(),
    createdAt: responseTimestamp,
    completedAt: nullableResponseTimestamp,
  })
  .openapi("WebhookDeliverySummary");

export const webhookDeliveryDetailSchema = webhookDeliverySummarySchema
  .extend({
    attempts: z.array(attemptSchema),
    responseSnippet: z.string().nullable().openapi({
      description:
        "The first 2 KB of the last response body as plain text. Never render it as HTML.",
    }),
    requestHeaders: z.record(z.string(), z.string()).openapi({
      description:
        "The request headers, rebuilt; the signature is masked as v1=… and the timestamp and attempt are the last attempt's.",
    }),
    requestBody: z.unknown().openapi({
      description: "The stored JSON body every attempt sends.",
    }),
  })
  .openapi("WebhookDeliveryDetail");

export const webhookDeliveryPageSchema = z
  .object({
    items: z.array(webhookDeliverySummarySchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next page; null on the last page.",
    }),
  })
  .openapi("WebhookDeliveryPage");

export const webhookEventCatalogSchema = z
  .object({
    families: z.array(
      z.object({
        key: z.string(),
        events: z.array(
          z.object({ name: z.string(), entity: z.enum(WEBHOOK_ENTITY_TYPES) }),
        ),
      }),
    ),
  })
  .openapi("WebhookEventCatalog", {
    description:
      'Every public event by family. Subscribe with "*", "<family>.*" or event names. webhook.ping is only sent by the test route.',
  });

export const webhookDeletedSchema = z
  .object({ id: z.string() })
  .openapi("WebhookDeleted");

export type WebhookResponse = z.infer<typeof webhookSchema>;
export type WebhookDeliverySummary = z.infer<
  typeof webhookDeliverySummarySchema
>;
