import { useQuery } from "@tanstack/react-query";
import listWebhooks from "@/fetchers/webhook/list-webhooks";
import { webhookQueryKeys } from "./webhook-query-keys";

export function useWebhooks(
  workspaceId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: webhookQueryKeys.list(workspaceId ?? ""),
    queryFn: () => listWebhooks(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export default useWebhooks;
