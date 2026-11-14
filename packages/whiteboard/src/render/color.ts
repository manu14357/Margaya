// Colour parsing and the dark theme. Every colour that reaches canvas or SVG
// output goes through `parseCssColor` and is re-formatted, so a malformed value
// can never inject markup into an SVG attribute.

import type { RenderTheme } from "./types.js";

export type Rgba = { r: number; g: number; b: number; a: number };

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^rgba?\(\s*([^)]*)\)$/i;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function channel(part: string): number | null {
  const value = part.trim();
  if (!/^-?\d*\.?\d+%?$/.test(value)) return null;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return clamp(value.endsWith("%") ? (number / 100) * 255 : number, 0, 255);
}

function alphaChannel(part: string): number | null {
  const value = part.trim();
  if (!/^-?\d*\.?\d+%?$/.test(value)) return null;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return clamp(value.endsWith("%") ? number / 100 : number, 0, 1);
}

export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (value.toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = HEX.exec(value);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length <= 4) {
      digits = Array.from(digits, (digit) => digit + digit).join("");
    }
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a:
        digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const functional = FUNCTIONAL.exec(value);
  if (!functional) return null;
  const body = functional[1] as string;
  let parts: string[];
  let alphaPart: string | undefined;
  if (body.includes(",")) {
    parts = body.split(",");
    if (parts.length === 4) alphaPart = parts.pop();
  } else {
    const [colour, alpha] = body.split("/");
    parts = (colour ?? "").trim().split(/\s+/);
    alphaPart = alpha;
  }
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(channel);
  if (r == null || g == null || b == null) return null;
  const a = alphaPart === undefined ? 1 : alphaChannel(alphaPart);
  if (a == null) return null;
  return { r, g, b, a };
}

function hex2(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

export function formatColor(color: Rgba): string {
  if (color.a >= 1) return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  const alpha = Math.round(clamp(color.a, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

export function isTransparentColor(color: string | null | undefined): boolean {
  const parsed = parseCssColor(color);
  return !parsed || parsed.a === 0;
}

/** A safe, normalised form of `color`, or `fallback` when it does not parse. */
export function safeColor(
  color: string | null | undefined,
  fallback: string,
): string {
  const parsed = parseCssColor(color);
  return parsed ? formatColor(parsed) : fallback;
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue / 6, sat, light];
}

function fromHsl(hue: number, sat: number, light: number, a: number): Rgba {
  if (sat === 0) return { r: light * 255, g: light * 255, b: light * 255, a };
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const part = (shift: number) => {
    let t = hue + shift;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: part(1 / 3) * 255, g: part(0) * 255, b: part(-1 / 3) * 255, a };
}

const darkCache = new Map<string, string>();

/**
 * Dark theme mapping: lightness is inverted (into a slightly narrower range so
 * black ink becomes soft white and white paper becomes near-black) while hue
 * and saturation stay, so a red stays red.
 */
export function invertLightness(color: string): string {
  const cached = darkCache.get(color);
  if (cached !== undefined) return cached;
  const parsed = parseCssColor(color);
  let result: string;
  if (!parsed) result = "#d4d4d4";
  else if (parsed.a === 0) result = formatColor(parsed);
  else {
    const [hue, sat, light] = toHsl(parsed);
    result = formatColor(
      fromHsl(hue, sat, 0.07 + (1 - light) * 0.85, parsed.a),
    );
  }
  if (darkCache.size > 4096) darkCache.clear();
  darkCache.set(color, result);
  return result;
}

/** A drawable colour for the theme; unparsable input becomes `fallback`. */
export function themeColor(
  color: string | null | undefined,
  theme: RenderTheme,
  fallback = "#1e1e1e",
): string {
  const safe = safeColor(color, fallback);
  return theme === "dark" ? invertLightness(safe) : safe;
}

export function withAlpha(color: string, alpha: number): string {
  const parsed = parseCssColor(color);
  if (!parsed) return color;
  return formatColor({ ...parsed, a: clamp(parsed.a * alpha, 0, 1) });
}

/** Linear blend of two colours; `t = 0` is `a`, `t = 1` is `b`. */
export function mixColors(a: string, b: string, t: number): string {
  const from = parseCssColor(a);
  const to = parseCssColor(b);
  if (!from || !to) return a;
  const k = clamp(t, 0, 1);
  return formatColor({
    r: from.r + (to.r - from.r) * k,
    g: from.g + (to.g - from.g) * k,
    b: from.b + (to.b - from.b) * k,
    a: from.a + (to.a - from.a) * k,
  });
}

/** Relative colorLuminance (0 dark .. 1 light), for picking readable text. */
export function colorLuminance(color: string): number {
  const parsed = parseCssColor(color);
  if (!parsed) return 0;
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(parsed.r) +
    0.7152 * linear(parsed.g) +
    0.0722 * linear(parsed.b)
  );
}
