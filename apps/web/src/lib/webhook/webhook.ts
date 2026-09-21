import { DOCS_URL } from "@/constants/urls";
import type { UpdateWebhookInput, Webhook } from "@/types/webhook";
import { samePatterns } from "./patterns";

export const MAX_WEBHOOK_URL_LENGTH = 2048;
export const MAX_WEBHOOK_NAME_LENGTH = 100;
export const GRACE_HOUR_OPTIONS = [0, 1, 24, 72] as const;
export const DEFAULT_GRACE_HOURS = 24;
export const WEBHOOK_SIGNATURE_DOCS_URL = `${DOCS_URL}/core/functional/webhooks#verify-signatures`;

export type WebhookState = "active" | "paused" | "disabled";

/**
 * The client-side URL check: format and scheme only. The server's checks
 * (credentials, public destination, not this instance) are authoritative.
 */
export function isValidWebhookUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH) return false;
  try {
    const url = new URL(trimmed);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !!url.host
    );
  } catch {
    return false;
  }
}

/** The name, or the URL's host when the webhook has none. */
export function webhookDisplayName(webhook: Pick<Webhook, "name" | "url">) {
  if (webhook.name?.trim()) return webhook.name.trim();
  try {
    return new URL(webhook.url).host || webhook.url;
  } catch {
    return webhook.url;
  }
}

export function webhookState(
  webhook: Pick<Webhook, "isActive" | "disabledReason">,
): WebhookState {
  if (webhook.isActive) return "active";
  return webhook.disabledReason === "failures" ? "disabled" : "paused";
}

/** The most recent finished delivery outcome, from the webhook's health. */
export function lastDelivery(health: Webhook["health"]) {
  const success = health.lastSuccessAt;
  const failure = health.lastFailureAt;
  if (!success && !failure) return null;
  if (
    success &&
    (!failure || new Date(success).getTime() >= new Date(failure).getTime())
  ) {
    return { result: "succeeded" as const, at: success };
  }
  return { result: "failed" as const, at: failure as string };
}

export type WebhookFormValues = {
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
};

/** Only the fields that changed; an empty object means nothing to save. */
export function webhookChanges(
  original: Pick<Webhook, "name" | "url" | "events" | "isActive">,
  values: WebhookFormValues,
): UpdateWebhookInput {
  const changes: UpdateWebhookInput = {};
  const name = values.name.trim();
  if (name !== (original.name ?? "")) changes.name = name || null;
  const url = values.url.trim();
  if (url !== original.url) changes.url = url;
  if (!samePatterns(values.events, original.events)) {
    changes.events = values.events;
  }
  if (values.isActive !== original.isActive) changes.isActive = values.isActive;
  return changes;
}
