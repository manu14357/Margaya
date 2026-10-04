import { useMutation, useQueryClient } from "@tanstack/react-query";
import testWebhook from "@/fetchers/webhook/test-webhook";
import { webhookQueryKeys } from "@/hooks/queries/webhook/webhook-query-keys";

export function useTestWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: testWebhook,
    onSettled: (_data, _error, id) =>
      queryClient.invalidateQueries({
        queryKey: webhookQueryKeys.deliveriesAll(id),
      }),
  });
}

export default useTestWebhook;
