import type {
  DeliveryStatusFilter,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
} from "@/types/webhook";

// The API's safe attempt errors (webhook/dispatch/policy.ts). They are fixed
// English strings, so the log maps them to translated labels here.
const ERROR_LABELS = {
  "Timed out after 10 seconds": "timeout",
  "Connection failed": "network",
  "Destination not allowed": "destination",
  "Redirects are not followed": "redirect",
  "Signing secret unavailable": "secret",
} as const;

export type ResponseLabelKind =
  | (typeof ERROR_LABELS)[keyof typeof ERROR_LABELS]
  | "cancelled";

export type ResponseLabel =
  | { type: "http"; status: number }
  | { type: "label"; kind: ResponseLabelKind }
  | { type: "text"; text: string }
  | null;

/** Waiting to be sent or retried, or being sent right now. */
export function isInFlight(status: WebhookDeliveryStatus) {
  return status === "pending" || status === "sending";
}

/**
 * What the Response column shows: the HTTP status, a known failure, the raw
 * error as a last resort, or nothing while no attempt has been made.
 */
export function responseLabel(
  delivery: Pick<WebhookDeliverySummary, "responseStatus" | "error" | "status">,
): ResponseLabel {
  const known = delivery.error
    ? ERROR_LABELS[delivery.error as keyof typeof ERROR_LABELS]
    : undefined;
  // A redirect has a 3xx status, but "not followed" is the useful part.
  if (known === "redirect") return { type: "label", kind: known };
  if (delivery.responseStatus !== null) {
    return { type: "http", status: delivery.responseStatus };
  }
  if (known) return { type: "label", kind: known };
  if (delivery.status === "cancelled") {
    return { type: "label", kind: "cancelled" };
  }
  if (delivery.error) return { type: "text", text: delivery.error };
  return null;
}

/** The list route's comma-separated status query for a toolbar filter. */
export function statusQueryOf(filter: DeliveryStatusFilter) {
  switch (filter) {
    case "all":
      return undefined;
    case "inProgress":
      return "pending,sending";
    default:
      return filter;
  }
}

export type RedeliverBlock = "inactive" | "inProgress" | "ping";

/** Why Redeliver is disabled for a delivery, or null when it is allowed. */
export function redeliverBlock(
  delivery: Pick<WebhookDeliverySummary, "status" | "trigger">,
  webhookIsActive: boolean,
): RedeliverBlock | null {
  if (delivery.trigger === "ping") return "ping";
  if (isInFlight(delivery.status)) return "inProgress";
  if (!webhookIsActive) return "inactive";
  return null;
}

/** Pretty-prints a stored request body; non-JSON values come back as text. */
export function formatRequestBody(body: unknown) {
  if (typeof body === "string") {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (body === undefined || body === null) return "";
  return JSON.stringify(body, null, 2);
}
