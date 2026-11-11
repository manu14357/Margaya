import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserSubscription,
  getPushSupport,
  registerPushWorker,
  subscribeBrowser,
} from "./push";

const publicDir = join(import.meta.dirname, "../../public");

function setNavigator(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }
}

function clearPushApis() {
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(window, "Notification");
}

function stubPushApis(existing: unknown = null) {
  const subscribed = { endpoint: "https://push.example.com/new" };
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => subscribed),
  };
  const registration = { pushManager };
  const serviceWorker = {
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  setNavigator({ serviceWorker });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: class {},
  });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "default" },
  });
  return { pushManager, serviceWorker, subscribed };
}

// A real P-256 public key from RFC 8291's example.
const KEY =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";

function keyBytes(key: string) {
  return Uint8Array.from(
    atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(88, "=")),
    (char) => char.charCodeAt(0),
  );
}

afterEach(() => {
  clearPushApis();
  setNavigator({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    platform: "Linux x86_64",
    maxTouchPoints: 0,
  });
  Reflect.deleteProperty(navigator, "standalone");
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  vi.restoreAllMocks();
});

describe("getPushSupport", () => {
  it("is supported when the browser has the APIs", () => {
    stubPushApis();
    expect(getPushSupport()).toBe("supported");
  });

  it("tells iPhone and iPad people to install first", () => {
    clearPushApis();
    setNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" });
    expect(getPushSupport()).toBe("install-required");

    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });
    expect(getPushSupport()).toBe("install-required");
  });

  it("does not ask an installed iOS app without the APIs to install again", () => {
    clearPushApis();
    setNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)",
      standalone: true,
    });
    expect(getPushSupport()).toBe("unsupported");
  });

  it("is unsupported elsewhere without the APIs, as on plain http", () => {
    clearPushApis();
    expect(getPushSupport()).toBe("unsupported");
  });
});

describe("inside the desktop app", () => {
  function enterDesktopApp() {
    Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
      configurable: true,
      value: { version: "0.1.0", platform: "windows" },
    });
  }

  it("is not offered even when the webview has the APIs", () => {
    stubPushApis();
    enterDesktopApp();
    expect(getPushSupport()).toBe("desktop-app");
  });

  it("never subscribes or reads a subscription", async () => {
    const { pushManager, serviceWorker } = stubPushApis();
    enterDesktopApp();
    await expect(subscribeBrowser(KEY)).rejects.toMatchObject({
      name: "NotSupportedError",
    });
    await expect(getBrowserSubscription()).resolves.toBeNull();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("browser subscription", () => {
  it("registers the worker at the root with the API address", async () => {
    const { serviceWorker } = stubPushApis();
    await registerPushWorker();
    const [url, options] = serviceWorker.register.mock.calls[0] as unknown as [
      string,
      RegistrationOptions,
    ];
    expect(url).toMatch(/^\/sw\.js\?api=/);
    expect(
      new URL(url, "https://app.example.com").searchParams.get("api"),
    ).toMatch(/\/api$/);
    expect(options).toEqual({ scope: "/", updateViaCache: "none" });
  });

  it("finds no subscription without touching a browser that lacks push", async () => {
    clearPushApis();
    await expect(getBrowserSubscription()).resolves.toBeNull();
  });

  it("asks for a visible subscription with the server's key", async () => {
    const { pushManager, subscribed } = stubPushApis();
    await expect(subscribeBrowser(KEY)).resolves.toBe(subscribed);
    const [options] = pushManager.subscribe.mock.calls[0] as unknown as [
      PushSubscriptionOptionsInit,
    ];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toEqual(keyBytes(KEY));
  });

  it("reuses a subscription made with the same key", async () => {
    const existing = {
      options: { applicationServerKey: keyBytes(KEY).buffer },
      unsubscribe: vi.fn(),
    };
    const { pushManager } = stubPushApis(existing);
    await expect(subscribeBrowser(KEY)).resolves.toBe(existing);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with a rotated key", async () => {
    const existing = {
      options: { applicationServerKey: new Uint8Array(65).buffer },
      unsubscribe: vi.fn(async () => true),
    };
    const { pushManager, subscribed } = stubPushApis(existing);
    await expect(subscribeBrowser(KEY)).resolves.toBe(subscribed);
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });
});

describe("site.webmanifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(publicDir, "site.webmanifest"), "utf8"),
  );

  it("has what browsers need to install the app", () => {
    expect(manifest.name).toBe("Margaya");
    expect(manifest.short_name).toBe("Margaya");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("offers 192 and 512 icons for both normal and maskable use", () => {
    for (const purpose of ["any", "maskable"]) {
      const sizes = manifest.icons
        .filter((icon: { purpose: string }) => icon.purpose === purpose)
        .map((icon: { sizes: string }) => icon.sizes);
      expect(sizes).toEqual(["192x192", "512x512"]);
    }
    for (const icon of manifest.icons) {
      expect(() =>
        readFileSync(join(publicDir, icon.src.replace(/^\//, ""))),
      ).not.toThrow();
    }
  });
});

describe("nginx", () => {
  it.each(["nginx.conf", "nginx.margaya.conf"])(
    "%s revalidates the worker and keeps the security headers",
    (file) => {
      const config = readFileSync(join(publicDir, "..", file), "utf8");
      const block = config.match(/location = \/sw\.js \{[^}]*\}/)?.[0] ?? "";
      expect(block).toContain("expires -1");
      // add_header in a location drops every server-level header.
      expect(block).not.toContain("add_header");
      expect(config).toContain("worker-src 'self' blob:");
      expect(config).toContain("manifest-src 'self'");
    },
  );
});
