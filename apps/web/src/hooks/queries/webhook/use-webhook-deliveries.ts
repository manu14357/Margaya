import { useInfiniteQuery } from "@tanstack/react-query";
import listWebhookDeliveries from "@/fetchers/webhook/list-webhook-deliveries";
import { isInFlight } from "@/lib/webhook/delivery";
import type { WebhookDeliveryFilters } from "@/types/webhook";
import { webhookQueryKeys } from "./webhook-query-keys";

const IN_FLIGHT_POLL_MS = 10_000;

/**
 * A webhook's delivery log, newest first, a page at a time. It polls every
 * 10 s while a loaded row is pending or sending.
 */
export function useWebhookDeliveries(
  webhookId: string,
  filters: WebhookDeliveryFilters,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: webhookQueryKeys.deliveries(webhookId, filters),
    queryFn: ({ pageParam }) =>
      listWebhookDeliveries({ webhookId, filters, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(webhookId) && enabled,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((item) => isInFlight(item.status)),
      )
        ? IN_FLIGHT_POLL_MS
        : false,
  });
}

export default useWebhookDeliveries;
