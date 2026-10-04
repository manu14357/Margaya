import { useMutation, useQueryClient } from "@tanstack/react-query";
import redeliverWebhookDelivery from "@/fetchers/webhook/redeliver-webhook-delivery";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";

export function useRedeliverWebhookDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      webhookId,
      deliveryId,
    }: {
      webhookId: string;
      deliveryId: string;
    }) => redeliverWebhookDelivery(webhookId, deliveryId),
    // The ["webhook", id] prefix covers the log and pendingDeliveries.
    onSettled: (_data, _error, { webhookId }) =>
      queryClient.invalidateQueries({
        queryKey: webhookQueryKeys.detail(webhookId),
      }),
  });
}

export default useRedeliverWebhookDelivery;
