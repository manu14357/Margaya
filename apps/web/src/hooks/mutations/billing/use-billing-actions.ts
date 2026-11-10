import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type BillingInterval,
  type BillingPlan,
  createBillingCheckout,
  createBillingPortal,
} from "@/fetchers/billing/create-checkout";
import { continueInSystemBrowser } from "@/lib/desktop";
import { toast as appToast } from "@/lib/toast";

/**
 * Checkout and the billing portal live on the payment provider's site. In
 * the desktop app they open in the browser, with a note to come back; the
 * plan refreshes when the window gets the focus again.
 */
function useLeaveForBilling(workspaceId: string | undefined) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (url: string) => {
    const inBrowser = continueInSystemBrowser(url, () => {
      void queryClient.invalidateQueries({
        queryKey: ["billing", workspaceId],
      });
    });
    if (!inBrowser) {
      window.location.href = url;
      return;
    }
    appToast.info(t("settings:continueInBrowser.title"), {
      description: t("settings:continueInBrowser.billing"),
    });
  };
}

export function useCreateCheckout(workspaceId: string | undefined) {
  const leave = useLeaveForBilling(workspaceId);
  return useMutation({
    mutationFn: (input: { plan: BillingPlan; interval: BillingInterval }) =>
      createBillingCheckout({ workspaceId: workspaceId as string, ...input }),
    onSuccess: ({ checkoutUrl }) => leave(checkoutUrl),
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Could not start checkout",
      );
    },
  });
}

export function useOpenBillingPortal(workspaceId: string | undefined) {
  const leave = useLeaveForBilling(workspaceId);
  return useMutation({
    mutationFn: () => createBillingPortal(workspaceId as string),
    onSuccess: ({ portalUrl }) => leave(portalUrl),
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not open billing portal",
      );
    },
  });
}
