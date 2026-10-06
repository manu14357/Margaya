import { useTranslation } from "react-i18next";
import { useTestWebhook } from "@/hooks/mutations/webhook/use-test-webhook";
import { useUpdateWebhook } from "@/hooks/mutations/webhook/use-update-webhook";
import { toast } from "@/lib/toast";

/** Send test: waits for the single attempt, then reports it in a toast. */
export function useSendWebhookTest() {
  const { t } = useTranslation();
  const test = useTestWebhook();

  const send = (webhookId: string) =>
    test.mutate(webhookId, {
      onSuccess: (delivery) => {
        if (delivery.status === "succeeded") {
          toast.success(
            t("settings:workspaceWebhooks.test.success", {
              status: delivery.responseStatus ?? 0,
              ms: delivery.durationMs ?? 0,
            }),
          );
          return;
        }
        const reason =
          delivery.error ??
          (delivery.responseStatus !== null
            ? t("settings:workspaceWebhooks.test.httpStatus", {
                status: delivery.responseStatus,
              })
            : t("settings:workspaceWebhooks.toast.error"));
        toast.error(t("settings:workspaceWebhooks.test.failure", { reason }));
      },
      onError: (error) =>
        toast.error(
          t("settings:workspaceWebhooks.test.failure", {
            reason:
              error.message || t("settings:workspaceWebhooks.toast.error"),
          }),
        ),
    });

  return {
    send,
    isPending: test.isPending,
    pendingId: test.isPending ? test.variables : undefined,
  };
}

/** Pause or enable a webhook (enabling resets its failure streak). */
export function useSetWebhookActive() {
  const { t } = useTranslation();
  const update = useUpdateWebhook();

  const setActive = (webhookId: string, isActive: boolean) =>
    update.mutate(
      { id: webhookId, input: { isActive } },
      {
        onSuccess: () =>
          toast.success(
            isActive
              ? t("settings:workspaceWebhooks.toast.enabled")
              : t("settings:workspaceWebhooks.toast.paused"),
          ),
        onError: (error) =>
          toast.error(
            error.message || t("settings:workspaceWebhooks.toast.error"),
          ),
      },
    );

  return { setActive, isPending: update.isPending };
}
