import type { WebhookDeliveryFilters } from "@/types/webhook";

// Every key of one webhook (its detail and delivery pages) shares the
// ["webhook", id] prefix, so one invalidation refreshes them all.
export const webhookQueryKeys = {
  list: (workspaceId: string) => ["webhooks", workspaceId] as const,
  detail: (id: string) => ["webhook", id] as const,
  deliveriesAll: (id: string) => ["webhook", id, "deliveries"] as const,
  deliveries: (id: string, filters: WebhookDeliveryFilters) =>
    ["webhook", id, "deliveries", filters] as const,
  delivery: (deliveryId: string) => ["webhook-delivery", deliveryId] as const,
  events: () => ["webhook-events"] as const,
};
