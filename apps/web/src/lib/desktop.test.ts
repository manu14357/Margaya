import { afterEach, describe, expect, it, vi } from "vitest";
import {
  externalHref,
  getDesktopBridge,
  getDesktopBrowserSignIn,
  installDesktopExternalLinks,
  isDesktopApp,
} from "./desktop";
import { desktopDiscoveryDocument } from "./desktop-discovery";

function enterDesktopApp(value: unknown) {
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("desktop app detection", () => {
  it("finds nothing in a browser", () => {
    expect(getDesktopBridge()).toBeNull();
    expect(isDesktopApp()).toBe(false);
    expect(getDesktopBrowserSignIn()).toBeNull();
  });

  it.each([null, "yes", 1, true])("ignores a bridge that is %s", (value) => {
    enterDesktopApp(value);
    expect(isDesktopApp()).toBe(false);
  });

  it("finds the bridge and tolerates missing methods", () => {
    enterDesktopApp({ version: "0.1.0", platform: "macos" });
    expect(isDesktopApp()).toBe(true);
    expect(getDesktopBridge()?.platform).toBe("macos");
    expect(getDesktopBrowserSignIn()).toBeNull();
    expect(installDesktopExternalLinks()).toBeTypeOf("function");
  });

  it("starts browser sign-in through the bridge", () => {
    const bridge = { startBrowserSignIn: vi.fn() };
    enterDesktopApp(bridge);
    getDesktopBrowserSignIn()?.();
    expect(bridge.startBrowserSignIn).toHaveBeenCalledOnce();
  });
});

describe("external links in the desktop app", () => {
  it("treats this server and its API as internal", () => {
    expect(externalHref("/dashboard")).toBeNull();
    expect(externalHref(`${window.location.origin}/x`)).toBeNull();
    // VITE_API_URL is unset in tests, so the API is the default address.
    expect(externalHref("http://localhost:1337/api/attachment/1")).toBeNull();
    expect(externalHref("mailto:pat@example.com")).toBeNull();
    expect(externalHref("https://docs.example.com/a")).toBe(
      "https://docs.example.com/a",
    );
  });

  it("does nothing outside the desktop app", () => {
    const open = window.open;
    installDesktopExternalLinks()();
    expect(window.open).toBe(open);
  });

  it("opens links that leave the server in the system browser", () => {
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    try {
      document.body.innerHTML = `
        <a id="out" href="https://docs.example.com/guide" target="_blank"><span>Docs</span></a>
        <a id="in" href="/dashboard">Home</a>`;
      const outside = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      document.querySelector("#out span")?.dispatchEvent(outside);
      expect(outside.defaultPrevented).toBe(true);
      expect(openExternal).toHaveBeenCalledWith(
        "https://docs.example.com/guide",
      );

      // Seen after the app's listener; then stopped, as jsdom can't navigate.
      let insidePrevented: boolean | undefined;
      const record = (event: Event) => {
        insidePrevented = event.defaultPrevented;
        event.preventDefault();
      };
      window.addEventListener("click", record);
      const inside = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      document.querySelector("#in")?.dispatchEvent(inside);
      window.removeEventListener("click", record);
      expect(insidePrevented).toBe(false);
      expect(openExternal).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("sends window.open for other origins to the system browser only", () => {
    const openExternal = vi.fn();
    const real = window.open;
    const original = vi.fn(() => null);
    window.open = original;
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    window.open("https://github.com/example/repo/issues/1", "_blank");
    window.open("/public/board/1", "_blank", "noopener");
    uninstall();

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/example/repo/issues/1",
    );
    expect(original).toHaveBeenCalledOnce();
    expect(original).toHaveBeenCalledWith(
      "/public/board/1",
      "_blank",
      "noopener",
    );
    expect(window.open).toBe(original);
    window.open = real;
  });
});

describe("desktop discovery document", () => {
  it.each([
    ["https://api.example.com", "https://api.example.com"],
    ["https://api.example.com/api/", "https://api.example.com"],
    ["https://example.com/margaya/api", "https://example.com/margaya"],
    [undefined, "http://localhost:1337"],
  ])("names the API for %s", (value, apiUrl) => {
    expect(JSON.parse(desktopDiscoveryDocument(value) ?? "null")).toEqual({
      apiUrl,
    });
  });

  it.each([
    "MARGAYA_API_URL",
    "/api",
    "ftp://api.example.com",
    "https://user:secret@api.example.com",
  ])("writes nothing for %s", (value) => {
    expect(desktopDiscoveryDocument(value)).toBeNull();
  });
});
