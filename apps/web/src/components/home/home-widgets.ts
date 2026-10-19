// The Home widget catalog. The API keeps the same keys (api/home/widgets.ts);
// home-page.tsx maps each key to its component.

export const HOME_WIDGET_KEYS = [
  "quick-links",
  "recents",
  "stickies",
  "risks",
  "my-brief",
] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];
export type HomeWidget = { key: HomeWidgetKey; enabled: boolean };

export const HOME_WIDGET_LABEL_KEYS: Record<HomeWidgetKey, string> = {
  "quick-links": "home:widgets.quickLinks",
  recents: "home:widgets.recents",
  stickies: "home:widgets.stickies",
  risks: "home:widgets.risks",
  "my-brief": "home:widgets.myBrief",
};

/** Opt-in widgets stay hidden until the person turns them on (My brief). */
export const OPT_IN_HOME_WIDGETS: ReadonlySet<HomeWidgetKey> = new Set([
  "my-brief",
]);

export const DEFAULT_HOME_WIDGETS: readonly HomeWidget[] = HOME_WIDGET_KEYS.map(
  (key) => ({ key, enabled: !OPT_IN_HOME_WIDGETS.has(key) }),
);

export function isHomeWidgetKey(value: unknown): value is HomeWidgetKey {
  return (HOME_WIDGET_KEYS as readonly unknown[]).includes(value);
}

/**
 * The list made current, as the API reads it: unknown keys dropped, the
 * first of duplicate keys kept, missing keys appended in default order,
 * enabled unless they are opt-in.
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
    if (!seen.has(key)) {
      widgets.push({ key, enabled: !OPT_IN_HOME_WIDGETS.has(key) });
    }
  }
  return widgets;
}

export function setWidgetEnabled(
  widgets: readonly HomeWidget[],
  key: HomeWidgetKey,
  enabled: boolean,
): HomeWidget[] {
  return widgets.map((widget) =>
    widget.key === key ? { ...widget, enabled } : widget,
  );
}

export function moveWidget(
  widgets: readonly HomeWidget[],
  activeKey: string,
  overKey: string,
): HomeWidget[] {
  const from = widgets.findIndex((widget) => widget.key === activeKey);
  const to = widgets.findIndex((widget) => widget.key === overKey);
  if (from === -1 || to === -1 || from === to) return [...widgets];
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
