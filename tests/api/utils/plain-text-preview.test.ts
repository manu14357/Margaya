import { describe, expect, it } from "vitest";
import { plainTextPreview } from "../../../apps/api/src/utils/plain-text-preview";

describe("plain-text preview", () => {
  it("turns mention tags into @label", () => {
    expect(
      plainTextPreview(
        'Hi <margaya-mention id="u1" label="Ana Lee"></margaya-mention>, look',
      ),
    ).toBe("Hi @Ana Lee, look");
  });

  it("strips headings, emphasis, lists, quotes, links and code", () => {
    expect(
      plainTextPreview(
        [
          "## Plan",
          "- **bold** and _italic_",
          "1. `code` step",
          "> quoted [link](https://example.com)",
          "```ts",
          "const x = 1;",
          "```",
        ].join("\n"),
      ),
    ).toBe("Plan bold and italic code step quoted link const x = 1;");
  });

  it("removes html tags and collapses whitespace", () => {
    expect(plainTextPreview("<p>One</p>\n\n<p>Two   three</p>")).toBe(
      "One Two three",
    );
    expect(plainTextPreview(null)).toBe("");
  });

  it("cuts long text on a word boundary with an ellipsis", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const preview = plainTextPreview(words);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(161);
    const head = preview.slice(0, -1);
    expect(words.startsWith(head)).toBe(true);
    expect(words[head.length]).toBe(" ");
  });

  it("keeps short text whole", () => {
    expect(plainTextPreview("x".repeat(160))).toBe("x".repeat(160));
  });

  it("strips empty list items and to-dos at line ends", () => {
    expect(plainTextPreview("- [ ]\n- \n1.\nnext")).toBe("next");
  });

  it("stays linear on long runs of blank lines and unclosed brackets", () => {
    const started = performance.now();
    for (const input of [
      "\n".repeat(20_000),
      "\n \n".repeat(6_000),
      "[".repeat(20_000),
      "![".repeat(10_000),
      "<a".repeat(10_000),
    ]) {
      plainTextPreview(`${input}x`, Number.POSITIVE_INFINITY);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
