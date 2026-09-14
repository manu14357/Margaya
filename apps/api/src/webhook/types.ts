// Shared vocabulary of workspace webhooks (B13a). Enum-like text columns are
// validated with Zod at the API edge, never with Postgres enums.

export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "sending",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const WEBHOOK_DELIVERY_TRIGGERS = [
  "event",
  "redelivery",
  "ping",
] as const;
export type WebhookDeliveryTrigger = (typeof WEBHOOK_DELIVERY_TRIGGERS)[number];

export const WEBHOOK_DISABLED_REASONS = ["manual", "failures"] as const;
export type WebhookDisabledReason = (typeof WEBHOOK_DISABLED_REASONS)[number];

export const WEBHOOK_ENTITY_TYPES = [
  "project",
  "column",
  "task",
  "comment",
  "reaction",
  "time_entry",
  "cycle",
  "module",
  "page",
  "view",
  "intake_item",
  "estimate",
  "webhook",
] as const;
export type WebhookEntityType = (typeof WEBHOOK_ENTITY_TYPES)[number];

/** One attempt as the delivery log keeps it. */
export type WebhookAttempt = {
  at: string;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
};

/** The sealed-secret purpose of webhook signing secrets. */
export const WEBHOOK_SECRET_PURPOSE = "webhook-secret";

export const MAX_WEBHOOKS_PER_WORKSPACE = 20;
export const MAX_WEBHOOK_URL_LENGTH = 2048;
export const MAX_WEBHOOK_NAME_LENGTH = 100;
export const MAX_WEBHOOK_PATTERNS = 100;
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
export const MAX_RESPONSE_SNIPPET_BYTES = 2048;
export const MAX_DELIVERY_SUMMARY_LENGTH = 200;
export const DEFAULT_MAX_ATTEMPTS = 6;
export const MAX_GRACE_HOURS = 72;
export const DEFAULT_GRACE_HOURS = 24;
export const DEFAULT_DELIVERY_RETENTION_DAYS = 14;
/** `page.content_updated` waits this long so edits coalesce (K14). */
export const COALESCE_DELAY_MS = 60 * 1000;
