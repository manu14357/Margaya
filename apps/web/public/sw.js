// Web push only. There is deliberately no fetch handler: this worker caches and
// intercepts nothing, so API responses are never stale and a new app version
// loads the moment it is deployed. It is registered from src/lib/push.ts with
// the API's base URL in `?api=`.

const FALLBACK_TITLE = "Margaya";
const FALLBACK_BODY = "You have a new notification.";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {
    // Still show something: browsers revoke push from sites that stay silent.
  }
  event.waitUntil(
    self.registration.showNotification(message.title || FALLBACK_TITLE, {
      body: message.body || FALLBACK_BODY,
      icon: "/web-app-manifest-192x192.png",
      badge: "/favicon-96x96.png",
      tag: message.tag,
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp(event.notification.data?.url));
});

// Only ever opens this app, whatever the message says.
async function openApp(url) {
  const origin = self.location.origin;
  const target = new URL(url || "/", origin);
  const href = target.origin === origin ? target.href : `${origin}/`;

  // Only a window this worker controls can be navigated. One it doesn't (a tab
  // opened with a hard reload) gets a new tab instead, decided before focus():
  // Chromium lets a click focus or open one window, not both.
  const [open] = await self.clients.matchAll({ type: "window" });
  if (!open) {
    await self.clients.openWindow(href);
    return;
  }
  try {
    await open.focus();
    await open.navigate(href);
  } catch {
    await self.clients.openWindow(href);
  }
}

// The browser replaced the subscription, so tell the API about the new one.
// Without this the old endpoint starts answering 410 and push silently stops.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(renewSubscription(event));
});

async function renewSubscription(event) {
  const api = new URL(self.location.href).searchParams.get("api");
  const applicationServerKey =
    event.oldSubscription?.options?.applicationServerKey;
  if (!api || (!event.newSubscription && !applicationServerKey)) return;

  const subscription =
    event.newSubscription ??
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));
  const { endpoint, keys } = subscription.toJSON();
  await fetch(`${api}/notification-preferences/push/subscriptions`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, keys }),
  });
}
