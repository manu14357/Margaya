import { getApiUrl } from "@/fetchers/get-api-url";
import { isDesktopApp } from "@/lib/desktop";

// The browser's side of web push: its service worker and subscription. What the
// server knows about this device goes through fetchers/notification-preferences.

export type PushSupport =
  | "supported"
  | "install-required"
  | "unsupported"
  // The desktop app delivers this device's notifications itself.
  | "desktop-app";

function isIos() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS asks for the desktop site and calls itself a Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function getPushSupport(): PushSupport {
  if (isDesktopApp()) return "desktop-app";
  if (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  ) {
    return "supported";
  }
  // iOS only offers push to an app added to the Home Screen.
  return isIos() && !isStandalone() ? "install-required" : "unsupported";
}

export function getPushPermission(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "default";
}

/**
 * Registered when the settings card opens rather than at startup, so people who
 * don't use push never get a worker. The later click can then subscribe without
 * waiting, which Safari needs to still count it as a tap.
 */
export function registerPushWorker() {
  return navigator.serviceWorker.register(
    `/sw.js?api=${encodeURIComponent(getApiUrl("").replace(/\/$/, ""))}`,
    { scope: "/", updateViaCache: "none" },
  );
}

export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  if (getPushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function decodeKey(key: string) {
  const padded = key.padEnd(key.length + ((4 - (key.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function usesKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey;
  if (!current || current.byteLength !== key.length) return false;
  const bytes = new Uint8Array(current);
  return key.every((byte, index) => byte === bytes[index]);
}

/**
 * Subscribes this browser and asks for permission if it hasn't been given.
 * Rejects with a NotAllowedError when the person refuses.
 */
export async function subscribeBrowser(publicKey: string) {
  if (getPushSupport() !== "supported") {
    throw new DOMException("Push is not offered here.", "NotSupportedError");
  }
  await registerPushWorker();
  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = decodeKey(publicKey);

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (usesKey(existing, applicationServerKey)) return existing;
    // The instance changed its keys; browsers refuse a second key alongside.
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}
