// Chrome colours drawn on the interactive canvas. Canvas cannot read CSS
// custom properties, so the theme tokens are resolved once per theme.

export type ChromeColors = {
  selection: string;
  selectionFill: string;
  handleFill: string;
  guide: string;
  bind: string;
  foreground: string;
  background: string;
  laser: string;
  eraser: string;
};

const FALLBACK: ChromeColors = {
  selection: "rgb(16, 185, 129)",
  selectionFill: "rgba(16, 185, 129, 0.08)",
  handleFill: "rgb(255, 255, 255)",
  guide: "rgb(219, 39, 119)",
  bind: "rgba(16, 185, 129, 0.35)",
  foreground: "rgb(28, 31, 29)",
  background: "rgb(250, 250, 247)",
  laser: "rgb(239, 68, 68)",
  eraser: "rgba(120, 120, 120, 0.5)",
};

let cached: { theme: string; colors: ChromeColors } | null = null;

/** Resolves `var(--token)` to a concrete colour the canvas can paint. */
export function resolveCssColor(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!match?.[1]) return value;
  if (typeof document === "undefined") return null;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(match[1])
    .trim();
  return resolved || null;
}

function token(name: string, fallback: string): string {
  return resolveCssColor(`var(${name})`) || fallback;
}

export function chromeColors(theme: "light" | "dark"): ChromeColors {
  if (cached?.theme === theme) return cached.colors;
  const ring = token("--ring", FALLBACK.selection);
  const colors: ChromeColors = {
    selection: ring,
    selectionFill: withAlpha(ring, 0.08),
    handleFill: token("--background", FALLBACK.handleFill),
    guide: token("--chart-4", FALLBACK.guide),
    bind: withAlpha(ring, 0.35),
    foreground: token("--foreground", FALLBACK.foreground),
    background: token("--background", FALLBACK.background),
    laser: token("--destructive", FALLBACK.laser),
    eraser: withAlpha(token("--muted-foreground", "rgb(120, 120, 120)"), 0.45),
  };
  cached = { theme, colors };
  return colors;
}

/** `#rrggbb`, `#rgb` or `rgb()` with an alpha channel. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex?.[1]) {
    const value =
      hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb?.[1]) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
