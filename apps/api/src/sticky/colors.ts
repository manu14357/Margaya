// The label color keys, reused as sticky backgrounds so the palette needs no
// new vocabulary. The web mirrors this list with its class names.
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
