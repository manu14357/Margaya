// Keyboard rules shared by the charts. Each chart is one tab stop; arrow
// keys move the active bucket, Home and End jump, Escape hides the readout.

/** Which arrows move: left/right, up/down, or both (the donut). */
export type ChartNavigationAxis = "horizontal" | "vertical" | "both";

const NEXT_KEYS: Record<ChartNavigationAxis, readonly string[]> = {
  horizontal: ["ArrowRight"],
  vertical: ["ArrowDown"],
  both: ["ArrowRight", "ArrowDown"],
};

const PREVIOUS_KEYS: Record<ChartNavigationAxis, readonly string[]> = {
  horizontal: ["ArrowLeft"],
  vertical: ["ArrowUp"],
  both: ["ArrowLeft", "ArrowUp"],
};

/**
 * The bucket index of the hover target under a pointer event, or null.
 * Hover targets carry `data-chart-index`; the charts listen once on the svg
 * and delegate, so the marks themselves stay plain graphics.
 */
export function chartIndexOf(target: EventTarget | null): number | null {
  if (!target || !(target instanceof Element)) return null;
  const element = target.closest("[data-chart-index]");
  if (!element) return null;
  const index = Number(element.getAttribute("data-chart-index"));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * The active index after `key`: a number to show, null to hide the
 * readout, or undefined when the chart does not handle the key (so it can
 * bubble, e.g. Escape closing a dialog when nothing is shown).
 */
export function chartKeyTarget(
  key: string,
  current: number | null,
  count: number,
  axis: ChartNavigationAxis,
): number | null | undefined {
  if (count <= 0) return undefined;
  if (key === "Escape") return current === null ? undefined : null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (NEXT_KEYS[axis].includes(key)) {
    return current === null ? 0 : Math.min(count - 1, current + 1);
  }
  if (PREVIOUS_KEYS[axis].includes(key)) {
    return current === null ? 0 : Math.max(0, current - 1);
  }
  return undefined;
}
