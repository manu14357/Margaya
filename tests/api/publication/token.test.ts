import { describe, expect, it } from "vitest";
import {
  generateLinkToken,
  isLinkTokenFormat,
  LINK_TOKEN_LENGTH,
  publicBoardPath,
} from "../../../apps/api/src/publication/token";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

describe("publication link tokens", () => {
  it("are 22 base62 characters and unique", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const token = generateLinkToken();
      expect(token).toHaveLength(LINK_TOKEN_LENGTH);
      expect(token).toMatch(/^[0-9A-Za-z]{22}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(500);
  });

  it("draws every character about equally often (no modulo bias)", () => {
    const counts = new Map<string, number>();
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) {
      for (const character of generateLinkToken()) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    const expected = (draws * LINK_TOKEN_LENGTH) / ALPHABET.length;
    expect(counts.size).toBe(ALPHABET.length);
    for (const character of ALPHABET) {
      const count = counts.get(character) ?? 0;
      // Far outside sampling noise for ~1,400 draws per character.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
    }
    // A plain `byte % 62` would favor the first 8 characters by ~25%.
    const sum = (characters: string) =>
      [...characters].reduce(
        (total, character) => total + (counts.get(character) ?? 0),
        0,
      );
    const first = sum(ALPHABET.slice(0, 8));
    const last = sum(ALPHABET.slice(-8));
    expect(Math.abs(first - last) / last).toBeLessThan(0.1);
  });

  it("accepts project ids and new tokens, refuses anything else", () => {
    expect(isLinkTokenFormat(generateLinkToken())).toBe(true);
    expect(isLinkTokenFormat("clx9a8b7c6d5e4f3g2h1i0jk")).toBe(true);
    expect(isLinkTokenFormat("with_dash-and_underscore")).toBe(true);
    for (const bad of [
      "",
      "short",
      "a".repeat(15),
      "a".repeat(65),
      "has space in the middle!",
      "../../etc/passwd/xxxxxxxx",
      "ümlautümlautümlaut",
    ]) {
      expect(isLinkTokenFormat(bad)).toBe(false);
    }
    expect(publicBoardPath("abc")).toBe("/public-project/abc");
  });
});
