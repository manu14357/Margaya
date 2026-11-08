// The Home widget catalog. The API keeps the same keys (api/home/widgets.ts);
// home-page.tsx maps each key to its component.

export const HOME_WIDGET_KEYS = [
  "quick-links",
  "recents",
  "stickies",
  "risks",
  "my-brief",
  "pinned-reports",
] as const;

export type HomeWidgetKey = (typeof HOME_WIDGET_KEYS)[number];
export type HomeWidget = {
  key: HomeWidgetKey;
  enabled: boolean;
  /** pinned-reports only: the saved reports it shows, in order. */
  reportIds?: string[];
};

/** How many saved reports one person can pin to Home (as api/home/widgets.ts). */
export const MAX_PINNED_REPORTS = 6;

export const HOME_WIDGET_LABEL_KEYS: Record<HomeWidgetKey, string> = {
  "quick-links": "home:widgets.quickLinks",
  recents: "home:widgets.recents",
  stickies: "home:widgets.stickies",
  risks: "home:widgets.risks",
  "my-brief": "home:widgets.myBrief",
  "pinned-reports": "home:widgets.pinnedReports",
};

/** Opt-in widgets stay hidden until the person turns them on (My brief). */
export const OPT_IN_HOME_WIDGETS: ReadonlySet<HomeWidgetKey> = new Set([
  "my-brief",
  "pinned-reports",
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
    const { key, enabled, reportIds } = entry as {
      key?: unknown;
      enabled?: unknown;
      reportIds?: unknown;
    };
    if (!isHomeWidgetKey(key) || seen.has(key)) continue;
    seen.add(key);
    const pinned =
      key === "pinned-reports" && Array.isArray(reportIds)
        ? reportIds.filter((id): id is string => typeof id === "string")
        : [];
    widgets.push({
      key,
      enabled: enabled !== false,
      ...(pinned.length > 0 ? { reportIds: pinned } : {}),
    });
  }
  for (const key of HOME_WIDGET_KEYS) {
    if (!seen.has(key)) {
      widgets.push({ key, enabled: !OPT_IN_HOME_WIDGETS.has(key) });
    }
  }
  return widgets;
}

export function pinnedReportIds(widgets: readonly HomeWidget[]): string[] {
  return (
    widgets.find((widget) => widget.key === "pinned-reports")?.reportIds ?? []
  );
}

/**
 * The list with this report pinned or unpinned, or null when pinning would go
 * over the limit. Pins of reports that are gone (`liveIds`) don't count and
 * are dropped. The widget turns on with the first pin and off with the last,
 * so Home stays as it was for people who don't pin anything.
 */
export function togglePinnedReport(
  widgets: readonly HomeWidget[],
  reportId: string,
  liveIds: readonly string[],
): HomeWidget[] | null {
  const kept = pinnedReportIds(widgets).filter(
    (id) => id === reportId || liveIds.includes(id),
  );
  const next = kept.includes(reportId)
    ? kept.filter((id) => id !== reportId)
    : [...kept, reportId];
  if (next.length > MAX_PINNED_REPORTS) return null;
  return widgets.map((widget) =>
    widget.key === "pinned-reports"
      ? {
          key: widget.key,
          enabled: next.length > 0,
          ...(next.length > 0 ? { reportIds: next } : {}),
        }
      : widget,
  );
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
