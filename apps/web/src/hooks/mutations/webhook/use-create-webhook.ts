import { useMutation, useQueryClient } from "@tanstack/react-query";
import createWebhook from "@/fetchers/webhook/create-webhook";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWebhook,
    onSuccess: (webhook) =>
      queryClient.invalidateQueries({
        queryKey: webhookQueryKeys.list(webhook.workspaceId),
      }),
  });
}

export default useCreateWebhook;
