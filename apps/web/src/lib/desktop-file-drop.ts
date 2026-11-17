import { isDesktopApp } from "./desktop";

/** Elements the webview itself lets files or text be dropped into. */
const NATIVE_DROP_TARGET =
  'input, textarea, [contenteditable=""], [contenteditable="true"], .ProseMirror';
/** A file input takes a dropped file by the browser's default action. */
const FILE_INPUT = 'input[type="file"]';

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function closest(target: EventTarget | null, selector: string) {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Inside the desktop app, a file dropped where nothing takes it must not
 * open in the window: the webview would load the file in place of the app.
 * Drop zones (attachments, editors, the whiteboard) see the drag first and
 * claim it with `preventDefault`; this cancels only what is left, from the
 * window's bubble phase, and shows the no-drop cursor there. Drags without
 * files (board cards, text) are untouched. A no-op in a browser.
 */
export function installDesktopFileDropGuard(win: Window = window) {
  if (!isDesktopApp(win)) return () => {};

  const onDragOver = (event: DragEvent) => {
    if (event.defaultPrevented || !carriesFiles(event)) return;
    // Editors and fields decide for themselves while the pointer is over
    // them; the drop below still stops a file from opening.
    if (closest(event.target, NATIVE_DROP_TARGET)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  };
  const onDrop = (event: DragEvent) => {
    if (event.defaultPrevented || !carriesFiles(event)) return;
    if (closest(event.target, FILE_INPUT)) return;
    event.preventDefault();
  };

  win.addEventListener("dragover", onDragOver);
  win.addEventListener("drop", onDrop);
  return () => {
    win.removeEventListener("dragover", onDragOver);
    win.removeEventListener("drop", onDrop);
  };
}
