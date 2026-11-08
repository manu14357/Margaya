import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs public/sw.js against a stand-in for the worker's global scope.
const source = readFileSync(
  join(import.meta.dirname, "../../public/sw.js"),
  "utf8",
);

type Handler = (event: Record<string, unknown>) => void;

const ORIGIN = "https://app.example.com";
let handlers: Record<string, Handler>;
let worker: {
  location: URL;
  addEventListener: (type: string, handler: Handler) => void;
  skipWaiting: ReturnType<typeof vi.fn>;
  registration: {
    showNotification: ReturnType<typeof vi.fn>;
    pushManager: { subscribe: ReturnType<typeof vi.fn> };
  };
  clients: {
    claim: ReturnType<typeof vi.fn>;
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  };
};
let fetchMock: ReturnType<typeof vi.fn>;

function load(search = "") {
  handlers = {};
  worker = {
    location: new URL(`${ORIGIN}/sw.js${search}`),
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async () => undefined),
      pushManager: { subscribe: vi.fn() },
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    },
  };
  fetchMock = vi.fn(async () => new Response());
  new Function("self", "fetch", source)(worker, fetchMock);
}

/** Dispatches an event and waits for everything passed to waitUntil. */
async function dispatch(type: string, event: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  handlers[type]?.({
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    ...event,
  });
  await Promise.all(pending);
}

function pushEvent(data: unknown) {
  return { data: { json: () => data } };
}

function clickEvent(url: unknown) {
  return { notification: { close: vi.fn(), data: { url } } };
}

beforeEach(() => {
  load();
});

describe("service worker", () => {
  it("has no fetch handler, so it can't cache or break anything", () => {
    expect(handlers.fetch).toBeUndefined();
    expect(source).not.toMatch(/caches\./);
    expect(source).not.toMatch(/addEventListener\(\s*["']fetch/);
  });

  it("takes over at once, so a new version applies without a second reload", async () => {
    await dispatch("install");
    expect(worker.skipWaiting).toHaveBeenCalled();
    await dispatch("activate");
    expect(worker.clients.claim).toHaveBeenCalled();
  });

  it("shows the notification a push carries", async () => {
    await dispatch(
      "push",
      pushEvent({
        title: "Mina mentioned you",
        body: "You were mentioned in Ship the release.",
        url: "/dashboard/workspace/w/project/p/task/t",
        tag: "n1",
      }),
    );
    const [title, options] = worker.registration.showNotification.mock
      .calls[0] as [string, NotificationOptions];
    expect(title).toBe("Mina mentioned you");
    expect(options.body).toBe("You were mentioned in Ship the release.");
    expect(options.tag).toBe("n1");
    expect(options.data).toEqual({
      url: "/dashboard/workspace/w/project/p/task/t",
    });
  });

  it("always shows something: browsers revoke push from silent sites", async () => {
    await dispatch("push", { data: null });
    await dispatch("push", {
      data: {
        json: () => {
          throw new Error("not json");
        },
      },
    });
    expect(worker.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.registration.showNotification.mock.calls[0]?.[0]).toBe(
      "Margaya",
    );
  });

  it("opens the app at the notification's path when no window is open", async () => {
    const event = clickEvent("/dashboard/workspace/w/inbox");
    await dispatch("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(worker.clients.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/dashboard/workspace/w/inbox`,
    );
  });

  it("reuses an open window", async () => {
    const open = {
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    worker.clients.matchAll.mockResolvedValue([open]);
    await dispatch("notificationclick", clickEvent("/dashboard"));
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/dashboard`);
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when the open one can't be navigated", async () => {
    const open = {
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => {
        throw new TypeError("uncontrolled");
      }),
    };
    worker.clients.matchAll.mockResolvedValue([open]);
    await dispatch("notificationclick", clickEvent("/dashboard"));
    expect(worker.clients.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/dashboard`,
    );
  });

  it("opens a new tab when the open one isn't the worker's to navigate", async () => {
    // As in Chromium: a click lets the worker focus or open one window, not
    // both, and a tab opened with a hard reload isn't controlled, so the worker
    // can't navigate it.
    let allowance = 1;
    const useAllowance = async () => {
      if (allowance-- < 1) {
        throw new DOMException(
          "Not allowed to open a window.",
          "InvalidAccessError",
        );
      }
    };
    const uncontrolled = {
      focus: vi.fn(useAllowance),
      navigate: vi.fn(async () => {
        throw new TypeError("not the client's active service worker");
      }),
    };
    worker.clients.matchAll.mockImplementation(
      async (options?: { includeUncontrolled?: boolean }) =>
        options?.includeUncontrolled ? [uncontrolled] : [],
    );
    worker.clients.openWindow.mockImplementation(useAllowance);

    await dispatch(
      "notificationclick",
      clickEvent("/dashboard/workspace/w/inbox"),
    );

    expect(worker.clients.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/dashboard/workspace/w/inbox`,
    );
    expect(allowance).toBe(0);
  });

  it.each(["https://evil.example.com/phish", "//evil.example.com/phish"])(
    "never leaves the app for %s",
    async (url) => {
      await dispatch("notificationclick", clickEvent(url));
      expect(worker.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    },
  );

  it("tells the API about a subscription the browser replaced", async () => {
    load(`?api=${encodeURIComponent("https://api.example.com/api")}`);
    const renewed = {
      toJSON: () => ({
        endpoint: "https://push.example.com/new",
        keys: { p256dh: "p", auth: "a" },
      }),
    };
    worker.registration.pushManager.subscribe.mockResolvedValue(renewed);
    const applicationServerKey = new Uint8Array(65).buffer;

    await dispatch("pushsubscriptionchange", {
      oldSubscription: { options: { applicationServerKey } },
    });

    expect(worker.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.com/api/notification-preferences/push/subscriptions",
    );
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: "https://push.example.com/new",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("does nothing on a replaced subscription without what it needs", async () => {
    load();
    await dispatch("pushsubscriptionchange", {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });
});
