// Series colors for the SVG charts. Every color is an existing token; the
// class strings are spelled out in full so Tailwind can see them.

import type { CreatableColumnGroup } from "@/lib/column-groups";

export type ChartColor = {
  /** SVG fill class for bars, slices and markers. */
  fill: string;
  /** SVG stroke class for lines. */
  stroke: string;
  /** Background class for the HTML swatches in legends and tooltips. */
  swatch: string;
  /** An inline CSS color for user data (label colors); wins over the classes. */
  value?: string;
};

/** The five categorical slots, `--chart-1` … `--chart-5`. */
export const CHART_SLOT_COLORS: readonly ChartColor[] = [
  { fill: "fill-chart-1", stroke: "stroke-chart-1", swatch: "bg-chart-1" },
  { fill: "fill-chart-2", stroke: "stroke-chart-2", swatch: "bg-chart-2" },
  { fill: "fill-chart-3", stroke: "stroke-chart-3", swatch: "bg-chart-3" },
  { fill: "fill-chart-4", stroke: "stroke-chart-4", swatch: "bg-chart-4" },
  { fill: "fill-chart-5", stroke: "stroke-chart-5", swatch: "bg-chart-5" },
];

/** A chart with one series (no segment) draws it in the first slot. */
export const SINGLE_SERIES_COLOR: ChartColor = CHART_SLOT_COLORS[0];

/** The folded "Other" series. */
export const OTHER_CHART_COLOR: ChartColor = {
  fill: "fill-muted-foreground/60",
  stroke: "stroke-muted-foreground/60",
  swatch: "bg-muted-foreground/60",
};

/** The "none" bucket or series (Unassigned, No label, …). */
export const NONE_CHART_COLOR: ChartColor = {
  fill: "fill-muted-foreground/30",
  stroke: "stroke-muted-foreground/30",
  swatch: "bg-muted-foreground/30",
};

/**
 * Column group identity colors: the SVG twins of `barClassName` in
 * lib/column-groups.ts. Keep the two in step.
 */
export const GROUP_CHART_COLORS: Record<CreatableColumnGroup, ChartColor> = {
  backlog: {
    fill: "fill-muted-foreground/40",
    stroke: "stroke-muted-foreground/40",
    swatch: "bg-muted-foreground/40",
  },
  unstarted: { fill: "fill-info", stroke: "stroke-info", swatch: "bg-info" },
  started: {
    fill: "fill-warning",
    stroke: "stroke-warning",
    swatch: "bg-warning",
  },
  completed: {
    fill: "fill-success",
    stroke: "stroke-success",
    swatch: "bg-success",
  },
  cancelled: {
    fill: "fill-destructive/60",
    stroke: "stroke-destructive/60",
    swatch: "bg-destructive/60",
  },
};

export const CHART_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const;

export type ChartPriority = (typeof CHART_PRIORITIES)[number];

/**
 * Priority identity colors, mirroring constants/priority-colors.ts, where
 * medium is the lighter step of high.
 */
export const PRIORITY_CHART_COLORS: Record<ChartPriority, ChartColor> = {
  urgent: {
    fill: "fill-destructive",
    stroke: "stroke-destructive",
    swatch: "bg-destructive",
  },
  high: {
    fill: "fill-warning",
    stroke: "stroke-warning",
    swatch: "bg-warning",
  },
  medium: {
    fill: "fill-warning/55",
    stroke: "stroke-warning/55",
    swatch: "bg-warning/55",
  },
  low: { fill: "fill-info", stroke: "stroke-info", swatch: "bg-info" },
  "no-priority": {
    fill: "fill-muted-foreground/35",
    stroke: "stroke-muted-foreground/35",
    swatch: "bg-muted-foreground/35",
  },
};

/** A user-chosen color (a label's), applied inline. */
export function customChartColor(value: string): ChartColor {
  return { fill: "", stroke: "", swatch: "", value };
}

export const OTHER_SERIES_KEY = "other";
export const NONE_SERIES_KEY = "none";

/** FNV-1a: small, fast and stable across sessions and browsers. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The slot a key asks for before collisions are resolved. */
export function preferredSlot(key: string): number {
  return hashKey(key) % CHART_SLOT_COLORS.length;
}

/**
 * Stable slot per key: each key takes its preferred slot, or the next free
 * one when an earlier key (in the given natural order) already holds it. So
 * a key keeps its color when filters change, unless a collision displaces
 * it. Past five keys the slots repeat from the preferred one; the analytics
 * API folds anything beyond five named series into "Other" first.
 */
export function assignSlots(keys: readonly string[]): Map<string, number> {
  const slotCount = CHART_SLOT_COLORS.length;
  const taken = new Set<number>();
  const slots = new Map<string, number>();
  for (const key of keys) {
    if (slots.has(key)) continue;
    const preferred = preferredSlot(key);
    let slot = preferred;
    if (taken.size < slotCount) {
      while (taken.has(slot)) slot = (slot + 1) % slotCount;
    }
    taken.add(slot);
    slots.set(key, slot);
  }
  return slots;
}

export type SeriesColorScheme = "group" | "priority" | "slots";

/**
 * Colors for a list of series or bucket keys in natural order. `other` and
 * `none` always take their muted classes; `custom` (label colors, already
 * resolved to CSS colors) wins next; then the scheme's identity map; any
 * key left over gets a stable slot.
 */
export function buildSeriesColors(
  keys: readonly string[],
  {
    scheme = "slots",
    custom,
  }: {
    scheme?: SeriesColorScheme;
    custom?: Readonly<Record<string, string | null | undefined>>;
  } = {},
): Map<string, ChartColor> {
  const colors = new Map<string, ChartColor>();
  const slotted: string[] = [];
  for (const key of keys) {
    const customValue = custom?.[key];
    if (key === OTHER_SERIES_KEY) colors.set(key, OTHER_CHART_COLOR);
    else if (key === NONE_SERIES_KEY) colors.set(key, NONE_CHART_COLOR);
    else if (customValue) colors.set(key, customChartColor(customValue));
    else if (scheme === "group" && Object.hasOwn(GROUP_CHART_COLORS, key))
      colors.set(key, GROUP_CHART_COLORS[key as CreatableColumnGroup]);
    else if (scheme === "priority" && Object.hasOwn(PRIORITY_CHART_COLORS, key))
      colors.set(key, PRIORITY_CHART_COLORS[key as ChartPriority]);
    else slotted.push(key);
  }
  for (const [key, slot] of assignSlots(slotted)) {
    colors.set(key, CHART_SLOT_COLORS[slot]);
  }
  return colors;
}

/** Inline style for a color's user value, for SVG marks. */
export function fillStyle(color: ChartColor) {
  return color.value ? { fill: color.value } : undefined;
}

/** Inline style for a color's user value, for SVG lines. */
export function strokeStyle(color: ChartColor) {
  return color.value ? { stroke: color.value } : undefined;
}

/** Inline style for a color's user value, for HTML swatches. */
export function swatchStyle(color: ChartColor) {
  return color.value ? { backgroundColor: color.value } : undefined;
}
