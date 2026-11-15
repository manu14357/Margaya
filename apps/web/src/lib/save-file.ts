import { saveAs } from "file-saver";
import { isDesktopApp } from "@/lib/desktop";

/** The webview reads a blob when its download starts; keep it a while longer. */
const REVOKE_AFTER_MS = 40_000;

/**
 * Saves a file the page made (an export, a board image) under `fileName`.
 *
 * In the desktop app this is a plain `<a download>` click, which every
 * desktop webview turns into a native download that keeps the name (the app
 * saves it to Downloads). file-saver can't be used there: on macOS it takes
 * the app's WebKit view for an old Safari and opens a blank window or a
 * nameless `data:` URL instead, which the app refuses, so nothing was saved.
 * Browsers keep file-saver.
 */
export function saveFile(data: Blob, fileName: string) {
  if (!isDesktopApp()) {
    saveAs(data, fileName);
    return;
  }
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
