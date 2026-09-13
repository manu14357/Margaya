// The Home widget catalog. The web keeps the same keys with their components;
// later slices append keys here, and stored rows pick them up on read.
export const HOME_WIDGET_KEYS = ["quick-links", "recents", "stickies"] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];
export type HomeWidget = { key: HomeWidgetKey; enabled: boolean };

export const DEFAULT_HOME_WIDGETS: readonly HomeWidget[] = HOME_WIDGET_KEYS.map(
  (key) => ({ key, enabled: true }),
);

function isHomeWidgetKey(value: unknown): value is HomeWidgetKey {
  return (HOME_WIDGET_KEYS as readonly unknown[]).includes(value);
}

/**
 * A stored list made current: unknown keys dropped, the first of duplicate
 * keys kept, and missing known keys appended in default order, enabled.
 */
export function normalizeHomeWidgets(stored: unknown): HomeWidget[] {
  const widgets: HomeWidget[] = [];
  const seen = new Set<HomeWidgetKey>();
  for (const entry of Array.isArray(stored) ? stored : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { key, enabled } = entry as { key?: unknown; enabled?: unknown };
    if (!isHomeWidgetKey(key) || seen.has(key)) continue;
    seen.add(key);
    widgets.push({ key, enabled: enabled !== false });
  }
  for (const key of HOME_WIDGET_KEYS) {
    if (!seen.has(key)) widgets.push({ key, enabled: true });
  }
  return widgets;
}

/** True when the list names every known widget exactly once. */
export function listsEveryWidgetOnce(
  widgets: readonly { key: string }[],
): boolean {
  const keys = new Set(widgets.map((widget) => widget.key));
  return (
    widgets.length === HOME_WIDGET_KEYS.length &&
    keys.size === widgets.length &&
    HOME_WIDGET_KEYS.every((key) => keys.has(key))
  );
}

export function sameWidgetList(
  a: readonly HomeWidget[],
  b: readonly HomeWidget[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (widget, index) =>
        widget.key === b[index]?.key && widget.enabled === b[index]?.enabled,
    )
  );
}
