/**
 * The hash that asks a task page to focus its comment box. Margaya Desktop's
 * "Reply" button on a native notification opens the task with it.
 */
export const REPLY_HASH = "reply";

/** True for a location hash (with or without its `#`) that asks for it. */
export function isReplyHash(hash: string) {
  return hash.replace(/^#/, "") === REPLY_HASH;
}

/**
 * Brings the comment box inside `root` into view and focuses its editor.
 * The editor mounts a moment after the box, so this keeps looking for it
 * on each frame for up to `maxMs`. Returns a function that stops looking.
 */
export function focusReplyComposer(
  root: HTMLElement,
  { maxMs = 5_000, now = () => Date.now() } = {},
): () => void {
  const started = now();
  let frame = 0;
  let stopped = false;
  const attempt = () => {
    if (stopped) return;
    const editor = root.querySelector<HTMLElement>(".ProseMirror");
    if (editor) {
      root.scrollIntoView?.({ block: "center" });
      editor.focus();
      return;
    }
    if (now() - started < maxMs) frame = requestAnimationFrame(attempt);
  };
  attempt();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
