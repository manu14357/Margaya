import { getApiUrl } from "@/fetchers/get-api-url";

/**
 * What the Margaya desktop app injects into the server's web UI. The app may be
 * older or newer than this build, so every method is treated as optional at
 * runtime and nothing here assumes the bridge exists.
 */
/** "linux" comes from apps that run on Linux; older apps never send it. */
export type DesktopPlatform = "windows" | "macos" | "linux";

export type MargayaDesktopBridge = {
  version: string;
  platform: DesktopPlatform;
  /** Opens the system browser on this server's desktop sign-in page. */
  startBrowserSignIn(): void;
  openExternal(url: string): void;
  setBadge(count: number): void;
  showQuickAdd(): void;
  /**
   * The secret that ties a desktop sign-in's handoff token to this app, taken
   * once; /auth/complete sends it with the token.
   */
  takeHandoffSecret(): Promise<string | null>;
  /**
   * "custom" when the app draws no native title bar: the web app's top bar
   * becomes the window's drag area, and on Windows and Linux it draws the
   * window buttons. `leftInset` is the room the macOS traffic lights need.
   */
  titleBar: {
    style: "custom" | "native";
    platform: DesktopPlatform;
    leftInset: number;
    rightInset: number;
  };
  window: DesktopWindowApi;
  /** Opens the launcher's server list. */
  showServers(): void;
  /** The web session ended here; the app signs this server out too. */
  signedOut(): void;
  /**
   * Opens an identity provider's page (account linking) in a popup window
   * that shares this server's session and closes when it comes back here.
   */
  openSignInPopup(url: string): void;
  /** Sent once at start: this page handles `margaya:navigate` itself. */
  ready(info: { navigate: boolean }): void;
  /**
   * "system": the app shows each notification natively and plays its sound
   * (the system notification sound, by the user's sound settings), so the
   * page plays none of its own.
   */
  notificationSound: "system";
  /** "Mute sounds on this device" for this server's notifications. */
  setSoundMuted(muted: boolean): void;
};

export type DesktopWindowState = {
  maximized: boolean;
  focused: boolean;
  fullscreen: boolean;
};

export type DesktopWindowApi = {
  minimize(): void;
  toggleMaximize(): void;
  /** Hides the window; the app keeps running in the tray. */
  close(): void;
  /** Starts a native window move; call on a primary-button mousedown. */
  startDragging(): void;
  isMaximized(): Promise<boolean>;
  /** Returns the unsubscribe. */
  onStateChange(listener: (state: DesktopWindowState) => void): () => void;
};

/** The desktop app's window events, dispatched on `window`. */
export const DESKTOP_WINDOW_STATE_EVENT = "margaya:window-state";
export const DESKTOP_NAVIGATE_EVENT = "margaya:navigate";

type BridgeWindow = Window & { __MARGAYA_DESKTOP__?: unknown };

export function getDesktopBridge(
  win: Window = window,
): Partial<MargayaDesktopBridge> | null {
  const bridge = (win as BridgeWindow).__MARGAYA_DESKTOP__;
  return typeof bridge === "object" && bridge !== null
    ? (bridge as Partial<MargayaDesktopBridge>)
    : null;
}

export function isDesktopApp(win: Window = window): boolean {
  return getDesktopBridge(win) !== null;
}

/**
 * Returns a sign-in starter when the desktop app can finish redirect-based
 * sign-in (social, OIDC, SAML) in the system browser, where identity
 * providers allow it; null means sign in inside this window as usual.
 */
export function getDesktopBrowserSignIn(win: Window = window) {
  const bridge = getDesktopBridge(win);
  const start = bridge?.startBrowserSignIn;
  return typeof start === "function" ? () => start.call(bridge) : null;
}

/** The desktop handoff secret, or null in a browser or when the app has none. */
export async function takeDesktopHandoffSecret(
  win: Window = window,
): Promise<string | null> {
  const bridge = getDesktopBridge(win);
  const take = bridge?.takeHandoffSecret;
  if (typeof take !== "function") return null;
  try {
    const secret = await take.call(bridge);
    return typeof secret === "string" && secret ? secret : null;
  } catch {
    return null;
  }
}

/** Calls a bridge method when this version of the app has it. */
function callBridge(
  name:
    | "signedOut"
    | "showServers"
    | "openExternal"
    | "ready"
    | "setSoundMuted",
  win: Window,
  ...args: unknown[]
): boolean {
  const bridge = getDesktopBridge(win);
  const method = bridge?.[name];
  if (typeof method !== "function") return false;
  try {
    (method as (...values: unknown[]) => unknown).apply(bridge, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the desktop app plays notification sounds itself, with its
 * native notifications; the page must then stay silent so each notification
 * sounds once.
 */
export function desktopPlaysNotificationSound(win: Window = window): boolean {
  return getDesktopBridge(win)?.notificationSound === "system";
}

/** Tells the desktop app whether sounds are muted on this device. */
export function notifyDesktopSoundMuted(
  muted: boolean,
  win: Window = window,
): void {
  callBridge("setSoundMuted", win, muted);
}

/** Tells the desktop app the web session ended, so it signs out too. */
export function notifyDesktopSignedOut(win: Window = window): void {
  callBridge("signedOut", win);
}

/**
 * Opens an http(s) URL in the desktop app's sign-in popup, or null when this
 * is a browser or an app version without one.
 */
export function getDesktopSignInPopup(win: Window = window) {
  const bridge = getDesktopBridge(win);
  const open = bridge?.openSignInPopup;
  if (typeof open !== "function") return null;
  return (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return false;
    open.call(bridge, parsed.href);
    return true;
  };
}

/** Opens the launcher's server list; null outside the desktop app. */
export function getDesktopShowServers(win: Window = window) {
  const bridge = getDesktopBridge(win);
  const show = bridge?.showServers;
  return typeof show === "function" ? () => show.call(bridge) : null;
}

export type DesktopTitleBar = MargayaDesktopBridge["titleBar"];

/**
 * The custom title bar's settings, or null when the window has a native
 * title bar or this is a browser. Insets are clamped to sane pixel values.
 */
export function getDesktopTitleBar(
  win: Window = window,
): DesktopTitleBar | null {
  const titleBar = getDesktopBridge(win)?.titleBar as unknown;
  if (typeof titleBar !== "object" || titleBar === null) return null;
  const value = titleBar as Partial<Record<keyof DesktopTitleBar, unknown>>;
  if (value.style !== "custom") return null;
  const inset = (raw: unknown) =>
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(Math.max(Math.round(raw), 0), 240)
      : 0;
  return {
    style: "custom",
    platform: desktopPlatform(value.platform),
    leftInset: inset(value.leftInset),
    rightInset: inset(value.rightInset),
  };
}

/** A bridge's platform; anything unknown is treated like Windows. */
export function desktopPlatform(value: unknown): DesktopPlatform {
  return value === "macos" || value === "linux" ? value : "windows";
}

/** The window controls, or null when this version of the app has none. */
export function getDesktopWindow(
  win: Window = window,
): Partial<DesktopWindowApi> | null {
  const api = getDesktopBridge(win)?.window as unknown;
  return typeof api === "object" && api !== null
    ? (api as Partial<DesktopWindowApi>)
    : null;
}

/**
 * Opens `url` in the system browser through the desktop app. False in a
 * browser or for anything but http(s), so the caller falls back.
 */
export function openInSystemBrowser(url: string, win: Window = window) {
  let parsed: URL;
  try {
    parsed = new URL(url, win.location.href);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return callBridge("openExternal", win, parsed.href);
}

/** Runs `listener` once, the next time this window gets the focus back. */
export function onNextWindowFocus(
  listener: () => void,
  win: Window = window,
): () => void {
  const run = () => {
    win.removeEventListener("focus", run);
    listener();
  };
  win.addEventListener("focus", run);
  return () => win.removeEventListener("focus", run);
}

function serverOrigins(win: Window) {
  const origins = new Set([win.location.origin]);
  try {
    // A separately hosted API is still this server: its links (downloads,
    // exports) need this window's session.
    origins.add(new URL(getApiUrl(""), win.location.href).origin);
  } catch {}
  return origins;
}

/** The absolute http(s) URL when `href` leaves this server, else null. */
export function externalHref(
  href: string | URL | null | undefined,
  win: Window = window,
): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(String(href), win.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return serverOrigins(win).has(url.origin) ? null : url.href;
}

const REPEAT_OPEN_MS = 500;
const EDITABLE_EDITOR = '[contenteditable=""], [contenteditable="true"]';

/**
 * Inside the desktop app, sends links that leave this server to the system
 * browser. The app also catches such navigation itself; this only saves the
 * round trip for ordinary link clicks and window.open calls.
 */
export function installDesktopExternalLinks(win: Window = window) {
  const bridge = getDesktopBridge(win);
  const openExternal = bridge?.openExternal;
  if (typeof openExternal !== "function") return () => {};
  // A link in a read-only editor opens through the editor's own window.open,
  // then its click reaches the document too: one press, two opens.
  let last: { url: string; at: number } | null = null;
  const open = (url: string) => {
    const now = Date.now();
    if (last && last.url === url && now - last.at < REPEAT_OPEN_MS) return;
    last = { url, at: now };
    openExternal.call(bridge, url);
  };

  // Primary clicks, and middle-clicks (`auxclick`, button 1), which would
  // otherwise ask the webview for a new window.
  const onClick = (event: MouseEvent) => {
    const middle = event.type === "auxclick";
    if (event.defaultPrevented || event.button !== (middle ? 1 : 0)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download")
    )
      return;
    // An editable editor owns its primary link clicks: it opens them itself
    // (through window.open below) or just places the caret.
    if (!middle && anchor.closest(EDITABLE_EDITOR)) return;
    const url = externalHref(anchor.href, win);
    if (!url) return;
    event.preventDefault();
    open(url);
  };

  const originalOpen = win.open;
  win.open = function desktopOpen(url, target, features) {
    const external = externalHref(url, win);
    if (external) {
      open(external);
      return null;
    }
    return originalOpen.call(win, url, target, features);
  };
  win.document.addEventListener("click", onClick);
  win.document.addEventListener("auxclick", onClick);

  return () => {
    win.document.removeEventListener("click", onClick);
    win.document.removeEventListener("auxclick", onClick);
    win.open = originalOpen;
  };
}

/**
 * The same-origin path, query and hash that `raw` names, or null. Anything
 * that could leave this origin (absolute URLs, `//host`, backslashes,
 * control characters) is refused.
 */
export function desktopNavigatePath(
  raw: unknown,
  win: Window = window,
): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  let url: URL;
  try {
    url = new URL(raw, win.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== win.location.origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * In-app navigation from the desktop app (a notification click, a
 * `margaya://open` link, quick add's Open): the app dispatches
 * `margaya:navigate` with `{ path }`, and this routes there without a
 * reload. It then tells the app, once, that this page handles the event.
 */
export function installDesktopNavigation(
  navigate: (path: string) => void,
  win: Window = window,
) {
  if (!getDesktopBridge(win)) return () => {};

  const onNavigate = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const path = desktopNavigatePath(
      typeof detail === "object" && detail !== null
        ? (detail as { path?: unknown }).path
        : undefined,
      win,
    );
    if (path) navigate(path);
  };
  win.addEventListener(DESKTOP_NAVIGATE_EVENT, onNavigate);
  win.document.documentElement.dataset.margayaNavigate = "1";
  callBridge("ready", win, { navigate: true });

  return () => {
    win.removeEventListener(DESKTOP_NAVIGATE_EVENT, onNavigate);
    delete win.document.documentElement.dataset.margayaNavigate;
  };
}

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .ProseMirror';

function isEditable(target: EventTarget | null) {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * Browser keys that make no sense in an app window: history navigation
 * (which can leave the app for a stale page), Save page and Print page
 * (browser dialogs), View source and caret browsing. Only the browser's
 * default is stopped; app shortcuts on the same keys still run.
 */
export function isBrowserOnlyKey(
  event: KeyboardEvent,
  platform: DesktopPlatform,
): boolean {
  const key = event.key.toLowerCase();
  if (key === "browserback" || key === "browserforward" || key === "f7")
    return true;
  const arrow = key === "arrowleft" || key === "arrowright";
  // Windows and Linux: Alt+arrows go back and forward.
  if (platform !== "macos") {
    if (event.altKey && !event.ctrlKey && !event.metaKey && arrow) return true;
  } else if (event.metaKey && !event.altKey && !event.ctrlKey) {
    if (key === "[" || key === "]") return true;
    // ⌘← and ⌘→ move the caret in text; elsewhere they go back and forward.
    if (arrow && !event.shiftKey && !isEditable(event.target)) return true;
  }
  const mod = platform === "macos" ? event.metaKey : event.ctrlKey;
  return (
    mod &&
    !event.altKey &&
    !event.shiftKey &&
    (key === "s" || key === "p" || key === "u")
  );
}

/** Ctrl+, (⌘, on macOS): the usual desktop shortcut for settings. */
export function isSettingsKey(
  event: KeyboardEvent,
  platform: DesktopPlatform,
): boolean {
  const mod = platform === "macos" ? event.metaKey : event.ctrlKey;
  const other = platform === "macos" ? event.ctrlKey : event.metaKey;
  return (
    mod &&
    !other &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "," || event.code === "Comma")
  );
}

/**
 * The browser's own context menu (Back, Reload, Save as, Print) belongs to
 * a web page, not an app. It stays where it helps: text fields, editors and
 * selected text. Never on a link, where it offers "Open link in new window",
 * a window the app does not control.
 */
export function keepsBrowserContextMenu(
  event: MouseEvent,
  win: Window = window,
): boolean {
  const target = event.target;
  if (target instanceof Element && target.closest("a[href]")) return false;
  if (isEditable(target)) return true;
  const selection = win.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

/**
 * Makes the page behave like an app window inside the desktop app: no
 * browser context menu or browser-only keys, chrome that does not select
 * like page text (styled from `html[data-desktop-app]`) and Ctrl/⌘+, for
 * settings. A no-op in a browser.
 */
export function installDesktopAppBehaviour(
  { openSettings }: { openSettings: () => void },
  win: Window = window,
) {
  const bridge = getDesktopBridge(win);
  if (!bridge) return () => {};
  const platform = desktopPlatform(bridge.platform);
  const root = win.document.documentElement;
  root.dataset.desktopApp = platform;

  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (!keepsBrowserContextMenu(event, win)) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (isBrowserOnlyKey(event, platform)) event.preventDefault();
  };
  // Bubble phase: a screen that binds the same keys has had them first.
  const onSettingsKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !isSettingsKey(event, platform)) return;
    event.preventDefault();
    openSettings();
  };
  win.addEventListener("contextmenu", onContextMenu);
  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("keydown", onSettingsKey);

  return () => {
    win.removeEventListener("contextmenu", onContextMenu);
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("keydown", onSettingsKey);
    delete root.dataset.desktopApp;
  };
}

/**
 * Inside the desktop app, sends a flow that has to finish on another site
 * (checkout, a billing portal, a GitHub App install) to the system browser
 * instead of leaving the app, and runs `onReturn` when the person comes
 * back to the window. False in a browser, where the caller navigates as
 * before.
 */
export function continueInSystemBrowser(
  url: string,
  onReturn?: () => void,
  win: Window = window,
): boolean {
  if (!isDesktopApp(win)) return false;
  const external = externalHref(url, win);
  if (!external || !openInSystemBrowser(external, win)) return false;
  if (onReturn) onNextWindowFocus(onReturn, win);
  return true;
}
