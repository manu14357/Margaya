import { afterEach, describe, expect, it, vi } from "vitest";
import {
  continueInSystemBrowser,
  desktopNavigatePath,
  getDesktopShowServers,
  getDesktopTitleBar,
  installDesktopAppBehaviour,
  installDesktopExternalLinks,
  installDesktopNavigation,
  isBrowserOnlyKey,
  isSettingsKey,
  notifyDesktopSignedOut,
} from "./desktop";

function enterDesktopApp(value: unknown) {
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "__MARGAYA_DESKTOP__");
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

const click = (target: Element | null | undefined) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target?.dispatchEvent(event);
  return event;
};

describe("external links opened twice", () => {
  it("opens a read-only editor link once when its own handler opened it", () => {
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    try {
      document.body.innerHTML = `
        <div class="ProseMirror" contenteditable="false">
          <a id="link" href="https://docs.example.com/a" target="_blank">Docs</a>
        </div>`;
      const link = document.querySelector("#link") as HTMLAnchorElement;
      // The editor's handler opens it, then the click reaches the document.
      link.addEventListener("click", () => {
        window.open(link.href, "_blank", "noopener,noreferrer");
      });
      const event = click(link);
      expect(openExternal).toHaveBeenCalledOnce();
      // The native click is still stopped, so the app opens no second tab.
      expect(event.defaultPrevented).toBe(true);
    } finally {
      uninstall();
    }
  });

  it("sends a middle-click on an outside link to the system browser", () => {
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    try {
      document.body.innerHTML = `
        <a id="out" href="https://docs.example.com/guide"><span>Docs</span></a>
        <a id="in" href="/dashboard">Home</a>`;
      const middle = (target: Element | null) => {
        const event = new MouseEvent("auxclick", {
          bubbles: true,
          cancelable: true,
          button: 1,
        });
        target?.dispatchEvent(event);
        return event;
      };
      const outside = middle(document.querySelector("#out span"));
      expect(outside.defaultPrevented).toBe(true);
      expect(openExternal).toHaveBeenCalledWith(
        "https://docs.example.com/guide",
      );
      // A middle-click on this server's own links is the app's to handle.
      expect(middle(document.querySelector("#in")).defaultPrevented).toBe(
        false,
      );
      // The right button never opens anything.
      const right = new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      document.querySelector("#out")?.dispatchEvent(right);
      expect(openExternal).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("leaves link clicks in an editable editor to the editor", () => {
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    try {
      document.body.innerHTML = `
        <div class="ProseMirror" contenteditable="true">
          <p><a id="link" href="https://docs.example.com/a"><span>Docs</span></a></p>
        </div>`;
      const event = click(document.querySelector("#link span"));
      expect(openExternal).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      uninstall();
    }
  });

  it("opens the same link again after a moment, and other links at once", () => {
    vi.useFakeTimers();
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const uninstall = installDesktopExternalLinks();
    try {
      window.open("https://a.example.com/");
      window.open("https://b.example.com/");
      window.open("https://b.example.com/");
      expect(openExternal).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(600);
      window.open("https://b.example.com/");
      expect(openExternal).toHaveBeenCalledTimes(3);
    } finally {
      uninstall();
      vi.useRealTimers();
    }
  });
});

describe("in-app navigation from the desktop app", () => {
  it.each([
    ["/dashboard/workspace/w1/inbox", "/dashboard/workspace/w1/inbox"],
    ["/a?b=1#c", "/a?b=1#c"],
    ["/a/../b", "/b"],
  ])("accepts %s", (raw, path) => {
    expect(desktopNavigatePath(raw)).toBe(path);
  });

  it.each([
    "https://evil.example.com/x",
    "//evil.example.com/x",
    "/\\evil.example.com",
    "javascript:alert(1)",
    "dashboard",
    "/a\nb",
    "",
    42,
    null,
  ])("refuses %s", (raw) => {
    expect(desktopNavigatePath(raw)).toBeNull();
  });

  it("does nothing in a browser", () => {
    const navigate = vi.fn();
    installDesktopNavigation(navigate)();
    window.dispatchEvent(
      new CustomEvent("margaya:navigate", { detail: { path: "/dashboard" } }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.margayaNavigate).toBeUndefined();
  });

  it("routes same-origin paths, refuses others and says it is ready", () => {
    const ready = vi.fn();
    enterDesktopApp({ ready });
    const navigate = vi.fn();
    const uninstall = installDesktopNavigation(navigate);
    try {
      expect(ready).toHaveBeenCalledWith({ navigate: true });
      expect(document.documentElement.dataset.margayaNavigate).toBe("1");
      const send = (detail: unknown) =>
        window.dispatchEvent(new CustomEvent("margaya:navigate", { detail }));
      send({ path: "https://evil.example.com/dashboard", id: "1" });
      send({ path: "//evil.example.com/dashboard", id: "2" });
      send("/dashboard");
      send(null);
      expect(navigate).not.toHaveBeenCalled();
      send({ path: "/dashboard/workspace/w1/task/t1?tab=activity", id: "3" });
      expect(navigate).toHaveBeenCalledWith(
        "/dashboard/workspace/w1/task/t1?tab=activity",
      );
    } finally {
      uninstall();
    }
    expect(document.documentElement.dataset.margayaNavigate).toBeUndefined();
  });

  it("works with an app version that has no ready message", () => {
    enterDesktopApp({ version: "0.1.0" });
    const navigate = vi.fn();
    const uninstall = installDesktopNavigation(navigate);
    window.dispatchEvent(
      new CustomEvent("margaya:navigate", { detail: { path: "/x" } }),
    );
    uninstall();
    expect(navigate).toHaveBeenCalledWith("/x");
  });
});

describe("desktop bridge calls", () => {
  it("tells the app about a sign-out, and nothing in a browser", () => {
    expect(() => notifyDesktopSignedOut()).not.toThrow();
    const signedOut = vi.fn();
    enterDesktopApp({ signedOut });
    notifyDesktopSignedOut();
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it("survives an older app without signedOut, or a throwing one", () => {
    enterDesktopApp({ version: "0.1.0" });
    expect(() => notifyDesktopSignedOut()).not.toThrow();
    enterDesktopApp({
      signedOut: () => {
        throw new Error("gone");
      },
    });
    expect(() => notifyDesktopSignedOut()).not.toThrow();
  });

  it("offers the server list only when the app has one", () => {
    expect(getDesktopShowServers()).toBeNull();
    const showServers = vi.fn();
    enterDesktopApp({ showServers });
    getDesktopShowServers()?.();
    expect(showServers).toHaveBeenCalledOnce();
  });

  it("reads the title bar only when it is custom", () => {
    expect(getDesktopTitleBar()).toBeNull();
    enterDesktopApp({ titleBar: { style: "native", platform: "windows" } });
    expect(getDesktopTitleBar()).toBeNull();
    enterDesktopApp({
      titleBar: {
        style: "custom",
        platform: "macos",
        leftInset: 78.4,
        rightInset: -5,
      },
    });
    expect(getDesktopTitleBar()).toEqual({
      style: "custom",
      platform: "macos",
      leftInset: 78,
      rightInset: 0,
    });
    enterDesktopApp({
      titleBar: { style: "custom", platform: "linux", leftInset: 0 },
    });
    expect(getDesktopTitleBar()?.platform).toBe("linux");
    // A platform this build doesn't know gets the Windows buttons.
    enterDesktopApp({ titleBar: { style: "custom", platform: "haiku" } });
    expect(getDesktopTitleBar()?.platform).toBe("windows");
  });

  it("continues an outside flow in the browser and notices the return", () => {
    expect(continueInSystemBrowser("https://pay.example.com/c/1")).toBe(false);
    const openExternal = vi.fn();
    enterDesktopApp({ openExternal });
    const back = vi.fn();
    expect(continueInSystemBrowser("/dashboard", back)).toBe(false);
    expect(continueInSystemBrowser("https://pay.example.com/c/1", back)).toBe(
      true,
    );
    expect(openExternal).toHaveBeenCalledWith("https://pay.example.com/c/1");
    expect(back).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    expect(back).toHaveBeenCalledOnce();
  });
});

describe("app window behaviour", () => {
  const key = (init: KeyboardEventInit, target?: Element) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    (target ?? document.body).dispatchEvent(event);
    return event;
  };
  const rightClick = (target: Element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  const at = (id: string) => document.getElementById(id) as Element;

  it("changes nothing in a browser", () => {
    const openSettings = vi.fn();
    document.body.innerHTML = `<div id="x">x</div>`;
    const uninstall = installDesktopAppBehaviour({ openSettings });
    expect(rightClick(at("x")).defaultPrevented).toBe(false);
    expect(key({ key: "ArrowLeft", altKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(key({ key: ",", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(openSettings).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.desktopApp).toBeUndefined();
    uninstall();
  });

  it("keeps the browser menu only in fields, editors and selections, never on links", () => {
    enterDesktopApp({ platform: "windows" });
    const uninstall = installDesktopAppBehaviour({ openSettings: vi.fn() });
    try {
      document.body.innerHTML = `
        <div id="plain"><span id="text">Board</span></div>
        <input id="field" />
        <textarea id="area"></textarea>
        <div class="ProseMirror" contenteditable="true"><p id="editor">x</p></div>
        <a id="link" href="https://docs.example.com/">Docs</a>
        <div id="menu"></div>`;
      expect(rightClick(at("plain")).defaultPrevented).toBe(true);
      expect(rightClick(at("text")).defaultPrevented).toBe(true);
      expect(rightClick(at("field")).defaultPrevented).toBe(false);
      expect(rightClick(at("area")).defaultPrevented).toBe(false);
      expect(rightClick(at("editor")).defaultPrevented).toBe(false);
      expect(rightClick(at("link")).defaultPrevented).toBe(true);

      // Not even selected, or inside an editor: no "Open link in new window".
      const linkRange = document.createRange();
      linkRange.selectNodeContents(at("link"));
      window.getSelection()?.addRange(linkRange);
      expect(rightClick(at("link")).defaultPrevented).toBe(true);
      window.getSelection()?.removeAllRanges();
      at("editor").innerHTML =
        `<a id="editor-link" href="https://x.example.com/">x</a>`;
      expect(rightClick(at("editor-link")).defaultPrevented).toBe(true);

      // Selected text keeps Copy.
      const range = document.createRange();
      range.selectNodeContents(at("text"));
      window.getSelection()?.addRange(range);
      expect(rightClick(at("text")).defaultPrevented).toBe(false);
      window.getSelection()?.removeAllRanges();

      // The app's own context menus are left to themselves.
      const own = vi.fn((event: Event) => event.preventDefault());
      at("menu").addEventListener("contextmenu", own);
      expect(rightClick(at("menu")).defaultPrevented).toBe(true);
      expect(own).toHaveBeenCalledOnce();

      expect(document.documentElement.dataset.desktopApp).toBe("windows");
    } finally {
      uninstall();
    }
    expect(document.documentElement.dataset.desktopApp).toBeUndefined();
  });

  it("stops browser-only keys on Windows", () => {
    const k = (init: KeyboardEventInit) =>
      isBrowserOnlyKey(new KeyboardEvent("keydown", init), "windows");
    expect(k({ key: "ArrowLeft", altKey: true })).toBe(true);
    expect(k({ key: "ArrowRight", altKey: true })).toBe(true);
    expect(k({ key: "BrowserBack" })).toBe(true);
    expect(k({ key: "s", ctrlKey: true })).toBe(true);
    expect(k({ key: "p", ctrlKey: true })).toBe(true);
    expect(k({ key: "u", ctrlKey: true })).toBe(true);
    expect(k({ key: "F7" })).toBe(true);
    // Reload, find, copy, app chords and plain arrows stay.
    expect(k({ key: "r", ctrlKey: true })).toBe(false);
    expect(k({ key: "F5" })).toBe(false);
    expect(k({ key: "f", ctrlKey: true })).toBe(false);
    expect(k({ key: "c", ctrlKey: true })).toBe(false);
    expect(k({ key: "k", ctrlKey: true })).toBe(false);
    expect(k({ key: "ArrowLeft" })).toBe(false);
    expect(k({ key: "ArrowLeft", ctrlKey: true })).toBe(false);
  });

  it("stops the same browser-only keys on Linux as on Windows", () => {
    const k = (init: KeyboardEventInit) =>
      isBrowserOnlyKey(new KeyboardEvent("keydown", init), "linux");
    expect(k({ key: "ArrowLeft", altKey: true })).toBe(true);
    expect(k({ key: "s", ctrlKey: true })).toBe(true);
    expect(k({ key: "s", metaKey: true })).toBe(false);
    expect(k({ key: "r", ctrlKey: true })).toBe(false);
    const e = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(isSettingsKey(e({ key: ",", ctrlKey: true }), "linux")).toBe(true);
    expect(isSettingsKey(e({ key: ",", metaKey: true }), "linux")).toBe(false);
  });

  it("marks the page with the Linux platform", () => {
    enterDesktopApp({ platform: "linux" });
    const uninstall = installDesktopAppBehaviour({ openSettings: vi.fn() });
    try {
      expect(document.documentElement.dataset.desktopApp).toBe("linux");
    } finally {
      uninstall();
    }
  });

  it("stops history keys on macOS but keeps text editing keys", () => {
    document.body.innerHTML = `<input id="f" /><div id="d"></div>`;
    const k = (init: KeyboardEventInit, target: Element) => {
      const event = new KeyboardEvent("keydown", init);
      Object.defineProperty(event, "target", { value: target });
      return isBrowserOnlyKey(event, "macos");
    };
    expect(k({ key: "[", metaKey: true }, at("d"))).toBe(true);
    expect(k({ key: "ArrowLeft", metaKey: true }, at("d"))).toBe(true);
    expect(k({ key: "ArrowLeft", metaKey: true }, at("f"))).toBe(false);
    // Option+arrows move by word.
    expect(k({ key: "ArrowLeft", altKey: true }, at("f"))).toBe(false);
    expect(k({ key: "s", metaKey: true }, at("d"))).toBe(true);
    expect(k({ key: "s", ctrlKey: true }, at("d"))).toBe(false);
  });

  it("opens settings with Ctrl+, unless a screen already took it", () => {
    enterDesktopApp({ platform: "windows" });
    const openSettings = vi.fn();
    const uninstall = installDesktopAppBehaviour({ openSettings });
    try {
      expect(key({ key: "ArrowLeft", altKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(key({ key: ",", ctrlKey: true }).defaultPrevented).toBe(true);
      expect(openSettings).toHaveBeenCalledOnce();

      // Ctrl+Shift+, copies a task link: not settings.
      key({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true });
      expect(openSettings).toHaveBeenCalledOnce();

      document.body.innerHTML = `<div id="own"></div>`;
      at("own").addEventListener("keydown", (event) => event.preventDefault());
      key({ key: ",", ctrlKey: true }, at("own"));
      expect(openSettings).toHaveBeenCalledOnce();
    } finally {
      uninstall();
    }
  });

  it("matches Cmd+, on macOS", () => {
    const e = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(isSettingsKey(e({ key: ",", metaKey: true }), "macos")).toBe(true);
    expect(isSettingsKey(e({ key: ",", ctrlKey: true }), "macos")).toBe(false);
    expect(isSettingsKey(e({ key: ",", ctrlKey: true }), "windows")).toBe(true);
  });
});
