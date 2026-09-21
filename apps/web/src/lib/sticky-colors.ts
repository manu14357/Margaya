// Sticky backgrounds reuse the label color keys, mirroring the API's list.
// Class strings are written out in full so Tailwind generates them; they use
// palette colors with opacity only, so no new design tokens exist.

export const STICKY_COLORS = [
  "gray",
  "dark-gray",
  "purple",
  "teal",
  "green",
  "yellow",
  "orange",
  "pink",
  "red",
] as const;

export type StickyColor = (typeof STICKY_COLORS)[number];

export const DEFAULT_STICKY_COLOR: StickyColor = "yellow";

export type StickyColorMeta = {
  key: StickyColor;
  /** The existing label color name. */
  nameKey: string;
  /** Card background and border, in both themes. */
  cardClassName: string;
  /** The solid swatch in the color picker. */
  swatchClassName: string;
};

const NAME_PREFIX = "common:modals.createTask.labelColors";

export const STICKY_COLOR_META: Record<StickyColor, StickyColorMeta> = {
  gray: {
    key: "gray",
    nameKey: `${NAME_PREFIX}.stone`,
    cardClassName: "border-stone-500/25 bg-stone-500/10 dark:bg-stone-500/18",
    swatchClassName: "bg-stone-500",
  },
  "dark-gray": {
    key: "dark-gray",
    nameKey: `${NAME_PREFIX}.slate`,
    cardClassName: "border-slate-500/25 bg-slate-500/10 dark:bg-slate-500/18",
    swatchClassName: "bg-slate-500",
  },
  purple: {
    key: "purple",
    nameKey: `${NAME_PREFIX}.lavender`,
    cardClassName:
      "border-violet-500/25 bg-violet-500/10 dark:bg-violet-500/18",
    swatchClassName: "bg-violet-500",
  },
  teal: {
    key: "teal",
    nameKey: `${NAME_PREFIX}.sage`,
    cardClassName:
      "border-emerald-500/25 bg-emerald-500/10 dark:bg-emerald-500/18",
    swatchClassName: "bg-emerald-500",
  },
  green: {
    key: "green",
    nameKey: `${NAME_PREFIX}.forest`,
    cardClassName: "border-green-500/25 bg-green-500/10 dark:bg-green-500/18",
    swatchClassName: "bg-green-500",
  },
  yellow: {
    key: "yellow",
    nameKey: `${NAME_PREFIX}.amber`,
    cardClassName: "border-amber-500/25 bg-amber-500/12 dark:bg-amber-500/18",
    swatchClassName: "bg-amber-500",
  },
  orange: {
    key: "orange",
    nameKey: `${NAME_PREFIX}.terracotta`,
    cardClassName:
      "border-orange-500/25 bg-orange-500/10 dark:bg-orange-500/18",
    swatchClassName: "bg-orange-500",
  },
  pink: {
    key: "pink",
    nameKey: `${NAME_PREFIX}.rose`,
    cardClassName: "border-rose-500/25 bg-rose-500/10 dark:bg-rose-500/18",
    swatchClassName: "bg-rose-500",
  },
  red: {
    key: "red",
    nameKey: `${NAME_PREFIX}.crimson`,
    cardClassName: "border-red-500/25 bg-red-500/10 dark:bg-red-500/18",
    swatchClassName: "bg-red-500",
  },
};

export function isStickyColor(value: unknown): value is StickyColor {
  return (
    typeof value === "string" &&
    (STICKY_COLORS as readonly string[]).includes(value)
  );
}

/** The palette entry of a stored color; unknown values read as yellow. */
export function getStickyColor(key: string | null | undefined) {
  return STICKY_COLOR_META[isStickyColor(key) ? key : DEFAULT_STICKY_COLOR];
}

export function randomStickyColor(random = Math.random): StickyColor {
  const index = Math.min(
    STICKY_COLORS.length - 1,
    Math.floor(random() * STICKY_COLORS.length),
  );
  return STICKY_COLORS[index];
}
