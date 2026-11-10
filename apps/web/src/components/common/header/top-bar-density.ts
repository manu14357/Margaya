import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * How much the top bar shows, from roomy to dense:
 *
 * - `full`: the command field, Ask, notifications and every action.
 * - `compact`: the command field becomes a search icon, the notifications
 *   bell leaves (Inbox is on the rail or the tab bar, with its badge), Ask
 *   and the page's secondary actions move into a "More" menu, and page
 *   actions drop their labels and secondary buttons.
 * - `tight`: also the place's tile, so the page's name stays readable.
 *
 * The width alone picks a starting point; if the bar still overflows (a page
 * with many actions, a long project name, the desktop app's window buttons)
 * it steps to the next density and remembers how wide the roomier one needed
 * to be, so it never flickers back and forth.
 */
export type TopBarDensity = "full" | "compact" | "tight";

const DENSITIES: readonly TopBarDensity[] = ["full", "compact", "tight"];

/** Below this content width the command field is an icon. */
export const TOP_BAR_COMPACT_WIDTH = 600;
/** Below this content width the bar keeps only the essentials. */
export const TOP_BAR_TIGHT_WIDTH = 300;

/** The density a bar of this content width starts from. */
export function densityForWidth(width: number): TopBarDensity {
  if (width < TOP_BAR_TIGHT_WIDTH) return "tight";
  if (width < TOP_BAR_COMPACT_WIDTH) return "compact";
  return "full";
}

/** The widths each density was seen to need (learned from overflow). */
export type TopBarNeeds = Partial<Record<TopBarDensity, number>>;

/**
 * The next density for a measurement: the roomiest density the width allows
 * that has not been seen to overflow at this width. An overflow (in px) at
 * the current density records what it needs and moves one step denser.
 */
export function nextTopBarDensity({
  current,
  width,
  overflow,
  needs,
}: {
  current: TopBarDensity;
  width: number;
  overflow: number;
  needs: TopBarNeeds;
}): { density: TopBarDensity; needs: TopBarNeeds } {
  let learned = needs;
  if (overflow > 1 && current !== "tight") {
    learned = {
      ...needs,
      [current]: Math.max(needs[current] ?? 0, Math.ceil(width + overflow)),
    };
  }
  const start = DENSITIES.indexOf(densityForWidth(width));
  for (let index = start; index < DENSITIES.length; index++) {
    const density = DENSITIES[index];
    if (density === "tight" || width >= (learned[density] ?? 0)) {
      return { density, needs: learned };
    }
  }
  return { density: "tight", needs: learned };
}

/** The content width of an element (its box without padding). */
function contentWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  return (
    element.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

/** How far an element's content spills past its box, in px. */
function spill(element: HTMLElement | null) {
  return element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0;
}

/** A first guess before the bar is measured (and in tests, which have no layout). */
function initialDensity(): TopBarDensity {
  if (typeof window === "undefined" || typeof window.innerWidth !== "number") {
    return "full";
  }
  return window.innerWidth < 768 ? "compact" : "full";
}

/**
 * Measures the top bar and its two clusters and keeps the density current
 * as the window, the panel or the page's actions change size.
 */
export function useMeasuredTopBarDensity() {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [place, setPlace] = useState<HTMLElement | null>(null);
  const [trailing, setTrailing] = useState<HTMLElement | null>(null);
  const [density, setDensity] = useState<TopBarDensity>(initialDensity);
  const needs = useRef<TopBarNeeds>({});
  const densityRef = useRef(density);
  densityRef.current = density;

  const measure = useCallback(() => {
    if (!bar || bar.clientWidth <= 0) return;
    const width = contentWidth(bar);
    const overflow = Math.max(spill(bar), spill(place), spill(trailing));
    const next = nextTopBarDensity({
      current: densityRef.current,
      width,
      overflow,
      needs: needs.current,
    });
    needs.current = next.needs;
    if (next.density !== densityRef.current) {
      densityRef.current = next.density;
      setDensity(next.density);
    }
  }, [bar, place, trailing]);

  // Every render may have changed what the clusters hold.
  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    for (const element of [bar, place, trailing]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [bar, place, trailing, measure]);

  return {
    density,
    barRef: setBar,
    placeRef: setPlace,
    trailingRef: setTrailing,
  };
}

const TopBarDensityContext = createContext<TopBarDensity>("full");

export const TopBarDensityProvider = TopBarDensityContext.Provider;

/**
 * The density of the top bar this component renders in ("full" outside a
 * top bar), so a page's place and actions can drop labels and secondary
 * buttons when the bar is crowded.
 */
export function useTopBarDensity() {
  return useContext(TopBarDensityContext);
}
