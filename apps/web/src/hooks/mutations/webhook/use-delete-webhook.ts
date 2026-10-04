import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteWebhook from "@/fetchers/webhook/delete-webhook";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";

export function useDeleteWebhook(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWebhook,
    onSuccess: ({ id }) => {
      queryClient.removeQueries({ queryKey: webhookQueryKeys.detail(id) });
      return queryClient.invalidateQueries({
        queryKey: webhookQueryKeys.list(workspaceId ?? ""),
      });
    },
  });
}

export default useDeleteWebhook;
