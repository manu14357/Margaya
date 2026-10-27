import type { ShellDestination } from "@/components/common/shell-destinations";

// The user's own sidebar: the order of the rail destinations and of the
// Projects panel sections, and which ones are hidden. Stored in the synced
// preferences (`sidebarLayout`); null means the default. Settings stays at
// the rail's foot and Home is always shown, so nobody can lock themselves
// out of navigation.

export const RAIL_ITEMS = [
  "home",
  "inbox",
  "my-work",
  "projects",
  "pages",
  "analytics",
] as const satisfies readonly ShellDestination[];
export type RailItem = (typeof RAIL_ITEMS)[number];

export const PANEL_SECTIONS = ["views", "favorites", "projects"] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];

/** Rail items that can't be hidden. */
export const ALWAYS_SHOWN_RAIL_ITEMS: readonly RailItem[] = ["home"];

export type SidebarLayout = {
  railOrder: RailItem[];
  railHidden: RailItem[];
  panelOrder: PanelSection[];
  panelHidden: PanelSection[];
};

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  railOrder: [...RAIL_ITEMS],
  railHidden: [],
  panelOrder: [...PANEL_SECTIONS],
  panelHidden: [],
};

/**
 * A saved order made whole: known items in the saved order, then any the
 * save does not mention (added later, or dropped) in the default order.
 */
export function completeOrder<T extends string>(
  saved: readonly string[] | undefined,
  all: readonly T[],
): T[] {
  const known = new Set<string>(all);
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const item of saved ?? []) {
    if (!known.has(item) || seen.has(item)) continue;
    seen.add(item);
    ordered.push(item as T);
  }
  for (const item of all) if (!seen.has(item)) ordered.push(item);
  return ordered;
}

/** The layout to show: whole orders, and only hideable items hidden. */
export function resolveSidebarLayout(
  layout: Partial<SidebarLayout> | null | undefined,
): SidebarLayout {
  const railHidden = new Set<string>(layout?.railHidden ?? []);
  const panelHidden = new Set<string>(layout?.panelHidden ?? []);
  return {
    railOrder: completeOrder(layout?.railOrder, RAIL_ITEMS),
    railHidden: RAIL_ITEMS.filter(
      (item) => railHidden.has(item) && !ALWAYS_SHOWN_RAIL_ITEMS.includes(item),
    ),
    panelOrder: completeOrder(layout?.panelOrder, PANEL_SECTIONS),
    panelHidden: PANEL_SECTIONS.filter((item) => panelHidden.has(item)),
  };
}

/** The visible rail destinations, in the user's order. */
export function visibleRailItems(
  layout: Partial<SidebarLayout> | null | undefined,
): RailItem[] {
  const resolved = resolveSidebarLayout(layout);
  return resolved.railOrder.filter(
    (item) => !resolved.railHidden.includes(item),
  );
}

/** The visible Projects panel sections, in the user's order. */
export function visiblePanelSections(
  layout: Partial<SidebarLayout> | null | undefined,
): PanelSection[] {
  const resolved = resolveSidebarLayout(layout);
  return resolved.panelOrder.filter(
    (item) => !resolved.panelHidden.includes(item),
  );
}

/** `items` with the one at `from` moved to `to` (both clamped). */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** True when the layout shows exactly what the default shows. */
export function isDefaultSidebarLayout(
  layout: Partial<SidebarLayout> | null | undefined,
): boolean {
  const resolved = resolveSidebarLayout(layout);
  return (
    resolved.railHidden.length === 0 &&
    resolved.panelHidden.length === 0 &&
    resolved.railOrder.every((item, index) => item === RAIL_ITEMS[index]) &&
    resolved.panelOrder.every((item, index) => item === PANEL_SECTIONS[index])
  );
}
