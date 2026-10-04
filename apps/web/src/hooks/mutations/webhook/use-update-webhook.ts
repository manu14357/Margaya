import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateWebhook from "@/fetchers/webhook/update-webhook";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";
import type { UpdateWebhookInput } from "@/types/webhook";

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWebhookInput }) =>
      updateWebhook(id, input),
    onSuccess: (webhook) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: webhookQueryKeys.list(webhook.workspaceId),
        }),
        // Pausing cancels pending deliveries, so the log changes too.
        queryClient.invalidateQueries({
          queryKey: webhookQueryKeys.detail(webhook.id),
        }),
      ]),
  });
}

export default useUpdateWebhook;
