// A link to one item on a long page (a comment, say) scrolls to it as soon
// as it renders, but the rest of the page may still be loading: content that
// appears above it pushes it out of view again. This keeps the item centred
// while its scroll container's content changes size, and lets go as soon as
// the person scrolls, clicks or types, or after `maxMs`.

const STOP_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

function scrollParentOf(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current && current !== document.body) {
    const { overflowY } = getComputedStyle(current);
    if (/(auto|scroll)/.test(overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

/** Centres `node` now and while the page settles. Returns a cleanup. */
export function keepAnchorInView(
  node: HTMLElement,
  { maxMs = 10_000 }: { maxMs?: number } = {},
): () => void {
  let active = true;
  const center = () => {
    if (active) node.scrollIntoView?.({ block: "center" });
  };

  const scroller = scrollParentOf(node);
  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(center);
  if (observer) {
    for (const child of Array.from((scroller ?? document.body).children)) {
      observer.observe(child);
    }
  }

  const stop = () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    clearTimeout(timer);
    for (const type of STOP_EVENTS) window.removeEventListener(type, stop);
  };
  const timer = setTimeout(stop, maxMs);
  for (const type of STOP_EVENTS) {
    window.addEventListener(type, stop, { passive: true });
  }

  center();
  return stop;
}
