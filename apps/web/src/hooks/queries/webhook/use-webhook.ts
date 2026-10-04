import { useQuery } from "@tanstack/react-query";
import getWebhook from "@/fetchers/webhook/get-webhook";
import { HttpError } from "@/lib/http-error";
import { webhookQueryKeys } from "./webhook-query-keys";

export function useWebhook(
  id: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: webhookQueryKeys.detail(id),
    queryFn: () => getWebhook(id),
    enabled: Boolean(id) && enabled,
    // A missing or foreign webhook stays missing, so a retry only delays it.
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
  });
}

export default useWebhook;
