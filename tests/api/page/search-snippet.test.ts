import { describe, expect, it } from "vitest";
import { buildSearchSnippet } from "../../../apps/api/src/page/snippet";

describe("page search snippet", () => {
  it("returns short text whole", () => {
    expect(buildSearchSnippet("Short  text\nhere", "text")).toBe(
      "Short text here",
    );
  });

  it("centers about 160 characters around the first match", () => {
    const text = `${"a".repeat(300)} needle ${"b".repeat(300)}`;
    const snippet = buildSearchSnippet(text, "NEEDLE");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
    expect(Array.from(snippet).length).toBeLessThanOrEqual(162);
    const at = snippet.indexOf("needle");
    expect(at).toBeGreaterThan(60);
    expect(at).toBeLessThan(100);
  });

  it("starts at the beginning for an early match and ends at the end for a late one", () => {
    const early = buildSearchSnippet(`needle ${"x".repeat(400)}`, "needle");
    expect(early.startsWith("needle")).toBe(true);
    expect(early.endsWith("…")).toBe(true);
    const late = buildSearchSnippet(`${"x".repeat(400)} needle`, "needle");
    expect(late.startsWith("…")).toBe(true);
    expect(late.endsWith("needle")).toBe(true);
  });

  it("never splits a multi-byte character", () => {
    const text = `${"😀".repeat(200)}needle${"🎉".repeat(200)}`;
    const snippet = buildSearchSnippet(text, "needle");
    expect(snippet).toContain("needle");
    expect(snippet).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(snippet).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(Array.from(snippet).length).toBeLessThanOrEqual(162);
  });

  it("falls back to the start without a match", () => {
    const snippet = buildSearchSnippet("y".repeat(400), "zzz");
    expect(snippet).toBe(`${"y".repeat(160)}…`);
  });
});
