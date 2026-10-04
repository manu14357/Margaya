import { useQuery } from "@tanstack/react-query";
import getWebhookDelivery from "@/fetchers/webhook/get-webhook-delivery";
import { isInFlight } from "@/lib/webhook/delivery";
import { webhookQueryKeys } from "./webhook-query-keys";

const IN_FLIGHT_POLL_MS = 10_000;

export function useWebhookDelivery(
  webhookId: string,
  deliveryId: string | null,
) {
  return useQuery({
    queryKey: webhookQueryKeys.delivery(deliveryId ?? ""),
    queryFn: () => getWebhookDelivery(webhookId, deliveryId ?? ""),
    enabled: Boolean(webhookId && deliveryId),
    refetchInterval: (query) =>
      query.state.data && isInFlight(query.state.data.status)
        ? IN_FLIGHT_POLL_MS
        : false,
  });
}

export default useWebhookDelivery;
