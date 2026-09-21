import { describe, expect, it } from "vitest";
import { computePageStats } from "./page-stats";

describe("computePageStats", () => {
  it("counts words, characters and non-empty paragraphs", () => {
    const stats = computePageStats(["Hello  world", "", "Second line here"]);
    expect(stats.words).toBe(5);
    expect(stats.characters).toBe(28);
    expect(stats.paragraphs).toBe(2);
  });

  it("reads under a minute as <1 min", () => {
    const stats = computePageStats(["one two three"]);
    expect(stats.underAMinute).toBe(true);
    expect(computePageStats([]).underAMinute).toBe(true);
    expect(computePageStats([]).readingMinutes).toBe(0);
  });

  it("rounds reading time up at 200 words a minute", () => {
    const words = (count: number) => Array(count).fill("word").join(" ");
    expect(computePageStats([words(200)]).readingMinutes).toBe(1);
    expect(computePageStats([words(200)]).underAMinute).toBe(false);
    expect(computePageStats([words(201)]).readingMinutes).toBe(2);
    expect(computePageStats([words(450)]).readingMinutes).toBe(3);
  });
});
