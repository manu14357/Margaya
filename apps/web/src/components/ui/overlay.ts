/**
 * The one modal state shared by Dialog, AlertDialog, Sheet and the command
 * palette: a single even dim over the whole window (rail, panel, top bar or
 * desktop title bar, page) with no blur, so nothing behind the overlay looks
 * brighter, sharper or active. The dim strength is the `--overlay-dim` token
 * (index.css, per theme); layers come from the `--z-*` tokens there too.
 *
 * `data-overlay-backdrop` marks the backdrop for the shared rules: only the
 * topmost open backdrop paints (index.css), and the desktop window buttons,
 * which stay above it to keep working, dim by the same amount (desktop.css).
 */
export const OVERLAY_BACKDROP_CLASS =
  "fixed inset-0 z-(--z-overlay) bg-(--overlay-backdrop) transition-[opacity,background-color] duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0";

/**
 * The positioning layer that holds an overlay's popup. Only the popup takes
 * presses: around it they fall through to the backdrop, so the backdrop is
 * what covers the app (a press there dismisses, as before).
 */
export const OVERLAY_VIEWPORT_CLASS =
  "pointer-events-none fixed inset-0 z-(--z-overlay) *:pointer-events-auto";

export const overlayBackdropProps = { "data-overlay-backdrop": "" } as const;
