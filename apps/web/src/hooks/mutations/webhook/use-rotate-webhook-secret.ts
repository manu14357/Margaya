import { useMutation, useQueryClient } from "@tanstack/react-query";
import rotateWebhookSecret from "@/fetchers/webhook/rotate-webhook-secret";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";

export function useRotateWebhookSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graceHours }: { id: string; graceHours: number }) =>
      rotateWebhookSecret(id, graceHours),
    onSuccess: (webhook) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: webhookQueryKeys.list(webhook.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: webhookQueryKeys.detail(webhook.id),
          exact: true,
        }),
      ]),
  });
}

export default useRotateWebhookSecret;
