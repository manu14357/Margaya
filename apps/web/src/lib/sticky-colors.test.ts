import { describe, expect, it } from "vitest";
import {
  DEFAULT_STICKY_COLOR,
  getStickyColor,
  isStickyColor,
  randomStickyColor,
  STICKY_COLOR_META,
  STICKY_COLORS,
} from "./sticky-colors";

// The API's palette (apps/api/src/sticky/colors.ts), kept in step by hand.
const API_COLORS = [
  "gray",
  "dark-gray",
  "purple",
  "teal",
  "green",
  "yellow",
  "orange",
  "pink",
  "red",
];

describe("sticky colors", () => {
  it("has an entry with a name and classes for every API key", () => {
    expect([...STICKY_COLORS]).toEqual(API_COLORS);
    for (const key of STICKY_COLORS) {
      const meta = STICKY_COLOR_META[key];
      expect(meta.key).toBe(key);
      expect(meta.nameKey).toMatch(/^common:modals\.createTask\.labelColors\./);
      expect(meta.cardClassName).toMatch(/\bbg-\S+\/\d+/);
      expect(meta.cardClassName).toMatch(/\bborder-\S+\/25/);
      expect(meta.swatchClassName).toMatch(/^bg-[a-z]+-500$/);
    }
  });

  it("falls back to yellow for unknown or missing values", () => {
    expect(DEFAULT_STICKY_COLOR).toBe("yellow");
    expect(getStickyColor("magenta").key).toBe("yellow");
    expect(getStickyColor(null).key).toBe("yellow");
    expect(getStickyColor("teal").key).toBe("teal");
  });

  it("picks a valid random key, including both ends of the range", () => {
    expect(randomStickyColor(() => 0)).toBe("gray");
    expect(randomStickyColor(() => 0.9999)).toBe("red");
    for (let i = 0; i < 50; i += 1) {
      expect(isStickyColor(randomStickyColor())).toBe(true);
    }
  });
});
