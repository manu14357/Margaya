import { useQuery } from "@tanstack/react-query";
import listWebhookEvents from "@/fetchers/webhook/list-webhook-events";
import { webhookQueryKeys } from "./webhook-query-keys";

/** The event catalog only changes with a deploy. */
export function useWebhookEvents({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  return useQuery({
    queryKey: webhookQueryKeys.events(),
    queryFn: listWebhookEvents,
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

export default useWebhookEvents;
