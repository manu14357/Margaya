import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import { statusQueryOf } from "@/lib/webhook/delivery";
import type { WebhookDeliveryFilters } from "@/types/webhook";

export const WEBHOOK_DELIVERY_PAGE_SIZE = 25;

/** One page of a webhook's delivery log, newest first. */
async function listWebhookDeliveries({
  webhookId,
  filters,
  cursor,
}: {
  webhookId: string;
  filters: WebhookDeliveryFilters;
  cursor?: string | null;
}) {
  const response = await client.webhook[":id"].deliveries.$get({
    param: { id: webhookId },
    query: {
      status: statusQueryOf(filters.status),
      event: filters.event || undefined,
      cursor: cursor || undefined,
      limit: String(WEBHOOK_DELIVERY_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listWebhookDeliveries;
