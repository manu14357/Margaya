import { desktopNavigatePath, isDesktopApp } from "./desktop";

/**
 * True inside the desktop app, where a page of this server can open in
 * another app window. Browsers have tabs and their own menus for that, so
 * "Open in new window" stays hidden there.
 */
export function canOpenInNewWindow(win: Window = window): boolean {
  return isDesktopApp(win);
}

/**
 * Opens a page of this server (a same-origin path such as
 * `/dashboard/...`) in another desktop app window. The app turns a
 * same-origin `window.open` into a window of its own on this server's
 * profile. False in a browser or for anything that isn't such a path.
 */
export function openInNewWindow(path: string, win: Window = window): boolean {
  if (!isDesktopApp(win)) return false;
  const safe = desktopNavigatePath(path, win);
  if (!safe) return false;
  win.open(new URL(safe, win.location.origin).href, "_blank");
  return true;
}

type ClickLike = {
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  preventDefault(): void;
};

/** Shift+click, or a middle click, asks for a new window. */
export function isNewWindowClick(event: ClickLike): boolean {
  if (event.button === 1) return true;
  return (
    event.button === 0 &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

/**
 * For items that navigate in code rather than through a link (task cards,
 * sidebar projects): inside the desktop app, Shift+click or a middle click
 * opens `path` in a new window, as it would for a link. True when it did,
 * so the caller skips its own navigation; always false in a browser.
 */
export function openInNewWindowOnClick(
  event: ClickLike,
  path: string,
  win: Window = window,
): boolean {
  if (!isNewWindowClick(event) || !openInNewWindow(path, win)) return false;
  event.preventDefault();
  return true;
}
