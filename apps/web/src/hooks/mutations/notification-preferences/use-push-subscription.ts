import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import deletePushSubscription from "@/fetchers/notification-preferences/delete-push-subscription";
import getPushStatus from "@/fetchers/notification-preferences/get-push-status";
import savePushSubscription from "@/fetchers/notification-preferences/save-push-subscription";
import { PUSH_STATUS_QUERY_KEY } from "@/hooks/queries/notification-preferences/use-get-push-status";
import { getBrowserSubscription, subscribeBrowser } from "@/lib/push";
import { toast } from "@/lib/toast";

async function saveBrowserOnServer(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error("The browser returned an incomplete subscription");
  }
  await savePushSubscription({
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  });
}

async function turnOnPush(publicKey: string) {
  await saveBrowserOnServer(await subscribeBrowser(publicKey));
}

async function forgetBrowserOnServer(subscription: PushSubscription) {
  const status = await getPushStatus();
  const device = status.subscriptions.find(
    ({ endpoint }) => endpoint === subscription.endpoint,
  );
  if (device) await deletePushSubscription(device.id);
}

async function turnOffPush() {
  const subscription = await getBrowserSubscription();
  if (!subscription) return;
  await forgetBrowserOnServer(subscription);
  await subscription.unsubscribe();
}

/**
 * The next person on a shared device must not get this account's alerts. Never
 * rejects: a failure here can't stop a sign-out. The browser unsubscribes
 * first, so a tab closed during the server call (whose beacon still ends the
 * session) leaves nothing subscribed; the server row then goes on the next
 * push, when the dead endpoint answers 410.
 */
export async function releasePushOnSignOut() {
  try {
    const subscription = await getBrowserSubscription();
    if (!subscription) return;
    await subscription.unsubscribe().catch(() => {});
    await forgetBrowserOnServer(subscription).catch(() => {});
  } catch {
    // Nothing else to try while signing out.
  }
}

/** This browser's subscription, when the server has it on for this account. */
async function browserWithPushOn() {
  const subscription = await getBrowserSubscription();
  if (!subscription) return null;
  const status = await getPushStatus();
  const isOn = status.subscriptions.some(
    ({ endpoint }) => endpoint === subscription.endpoint,
  );
  return isOn ? subscription : null;
}

/**
 * Runs an action that signs out the account's other sessions. The server then
 * takes every device off push, since it can't tell which one is this browser,
 * so this browser, which stays signed in, puts itself back if it was on. Push
 * can't fail the action: at worst the switch shows off and can be turned on.
 */
export async function withPushKeptOnThisDevice<T>(
  action: () => Promise<T>,
): Promise<T> {
  const browser = await browserWithPushOn().catch(() => null);
  const result = await action();
  if (browser) await saveBrowserOnServer(browser).catch(() => {});
  return result;
}

function useInvalidatePushStatus() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
}

export function useTurnOnPush() {
  const invalidate = useInvalidatePushStatus();

  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: turnOnPush,
    onSuccess: () => {
      toast.success(i18n.t("settings:notificationsPage.toastPushOn"));
    },
    onError: (error) => {
      // A refusal isn't a failure; the card explains how to allow it.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        return;
      }
      toast.error(i18n.t("settings:notificationsPage.toastPushOnFailed"));
    },
    onSettled: invalidate,
  });
}

export function useTurnOffPush() {
  const invalidate = useInvalidatePushStatus();

  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: turnOffPush,
    onSuccess: () => {
      toast.success(i18n.t("settings:notificationsPage.toastPushOff"));
    },
    onError: () => {
      toast.error(i18n.t("settings:notificationsPage.toastPushOffFailed"));
    },
    onSettled: invalidate,
  });
}

export function useRemovePushDevice() {
  const invalidate = useInvalidatePushStatus();

  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: deletePushSubscription,
    onSuccess: () => {
      toast.success(
        i18n.t("settings:notificationsPage.toastPushDeviceRemoved"),
      );
    },
    onError: () => {
      toast.error(
        i18n.t("settings:notificationsPage.toastPushDeviceRemoveFailed"),
      );
    },
    onSettled: invalidate,
  });
}
