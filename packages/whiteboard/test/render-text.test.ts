import { describe, expect, it } from "vitest";
import {
  ELLIPSIS,
  estimateTextWidth,
  FONT_STACKS,
  fontCss,
  layoutText,
  truncateText,
} from "../src/render/text.js";
import { fakeMeasure } from "./render-fixtures.js";

// fakeMeasure: 0.6 em per character, so at 10px each character is 6 units.
const options = { fontSize: 10, fontFamily: "sans", maxWidth: 60 } as const;

describe("layoutText", () => {
  it("wraps words at the max width", () => {
    const layout = layoutText("one two three four", options, fakeMeasure);
    expect(layout.lines).toEqual(["one two", "three four"]);
    expect(layout.width).toBe(60);
    expect(layout.lineHeightPx).toBe(12.5);
    expect(layout.height).toBe(25);
  });

  it("keeps explicit line breaks and empty lines", () => {
    const layout = layoutText("a\r\n\nb", options, fakeMeasure);
    expect(layout.lines).toEqual(["a", "", "b"]);
  });

  it("breaks a word longer than the line", () => {
    const layout = layoutText(
      "abcdefghijklmnopqrstuvwxyz",
      options,
      fakeMeasure,
    );
    expect(layout.lines).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
    for (const line of layout.lines) {
      expect(fakeMeasure(line, layout.font)).toBeLessThanOrEqual(60);
    }
  });

  it("does not wrap without a max width", () => {
    const layout = layoutText(
      "a long line that would wrap",
      { ...options, maxWidth: Number.POSITIVE_INFINITY },
      fakeMeasure,
    );
    expect(layout.lines).toHaveLength(1);
  });

  it("clamps to max lines with an ellipsis", () => {
    const layout = layoutText(
      "one two three four five six seven",
      { ...options, maxLines: 2 },
      fakeMeasure,
    );
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1]?.endsWith(ELLIPSIS)).toBe(true);
    expect(
      fakeMeasure(layout.lines[1] as string, layout.font),
    ).toBeLessThanOrEqual(60);
  });

  it("uses the line height multiplier", () => {
    const layout = layoutText("x", { ...options, lineHeight: 2 }, fakeMeasure);
    expect(layout.lineHeightPx).toBe(20);
  });
});

describe("fonts and measuring", () => {
  it("builds CSS font strings from the stacks", () => {
    expect(fontCss("hand", 20)).toBe(`20px ${FONT_STACKS.hand}`);
    expect(fontCss("mono", 12, 600)).toBe(`600 12px ${FONT_STACKS.mono}`);
    expect(FONT_STACKS.hand).toContain('"Margaya Hand"');
    expect(FONT_STACKS.hand.endsWith("cursive")).toBe(true);
  });

  it("truncates with an ellipsis", () => {
    const font = fontCss("sans", 10);
    const value = truncateText("abcdefghijkl", 36, font, fakeMeasure);
    expect(value.endsWith(ELLIPSIS)).toBe(true);
    expect(fakeMeasure(value, font)).toBeLessThanOrEqual(36);
    expect(truncateText("abc", 36, font, fakeMeasure)).toBe("abc");
  });

  it("estimates widths that grow with text and size", () => {
    const small = estimateTextWidth("Hello world", fontCss("sans", 10));
    const large = estimateTextWidth("Hello world", fontCss("sans", 20));
    expect(small).toBeGreaterThan(0);
    expect(large).toBeCloseTo(small * 2);
    expect(estimateTextWidth("WWW", "10px sans-serif")).toBeGreaterThan(
      estimateTextWidth("iii", "10px sans-serif"),
    );
  });
});
