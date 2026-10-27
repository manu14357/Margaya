import { describe, expect, it } from "vitest";
import {
  minimumSharedWords,
  similarityWords,
} from "../../../apps/api/src/task/similar-tasks";

describe("similarityWords", () => {
  it("keeps distinct significant words, lower case", () => {
    expect(similarityWords("Fix the Login page on Safari login")).toEqual([
      "login",
      "page",
      "safari",
    ]);
  });

  it("splits on punctuation and keeps non-Latin words", () => {
    expect(similarityWords("Ошибка входа: страница")).toEqual([
      "ошибка",
      "входа",
      "страница",
    ]);
  });

  it("keeps at most eight words", () => {
    expect(
      similarityWords(
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
      ),
    ).toHaveLength(8);
  });
});

describe("minimumSharedWords", () => {
  it("needs at least two words and half of a long title", () => {
    expect(minimumSharedWords(2)).toBe(2);
    expect(minimumSharedWords(3)).toBe(2);
    expect(minimumSharedWords(5)).toBe(3);
    expect(minimumSharedWords(8)).toBe(4);
  });
});
