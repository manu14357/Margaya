import { describe, expect, it } from "vitest";
import {
  STICKY_CONTENT_MAX_LENGTH,
  stickyPlainText,
} from "../../../apps/api/src/sticky/plain-text";

describe("sticky plain text", () => {
  it("turns mention tags into @label", () => {
    expect(
      stickyPlainText(
        'Ask <margaya-mention id="u1" label="Ada"></margaya-mention> today',
      ),
    ).toBe("Ask @Ada today");
  });

  it("drops other tags but keeps their text", () => {
    expect(
      stickyPlainText(
        'See <margaya-task-link id="t1">WEB-12</margaya-task-link><br>then ship',
      ),
    ).toBe("See WEB-12 then ship");
  });

  it("keeps image alt text and link text", () => {
    expect(
      stickyPlainText(
        "![diagram](https://x.test/a.png) and [the docs](https://x.test)",
      ),
    ).toBe("diagram and the docs");
  });

  it("removes heading, quote, list and task box markers, nested too", () => {
    expect(
      stickyPlainText(
        [
          "# Title",
          "> quoted",
          "- item",
          "  * nested",
          "1. first",
          "- [ ] open",
          "- [x] done",
          "- [ ]",
        ].join("\n"),
      ),
    ).toBe("Title quoted item nested first open done");
  });

  it("drops code fences and keeps the code", () => {
    expect(stickyPlainText("```ts\nconst x = 1;\n```\nafter")).toBe(
      "const x = 1; after",
    );
  });

  it("removes inline code, strike-through and emphasis markers", () => {
    expect(stickyPlainText("`npm i` ~~old~~ **ship**\nit _now_ *now*")).toBe(
      "npm i old ship it now now",
    );
  });

  it("flattens tables into their cells", () => {
    expect(
      stickyPlainText(
        ["| Name | Owner |", "| --- | :-: |", "| Api | Ada |"].join("\n"),
      ),
    ).toBe("Name Owner Api Ada");
  });

  it("decodes entities", () => {
    expect(
      stickyPlainText("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f"),
    ).toBe("a & b <c> \"d\" 'e' 'f");
  });

  it("collapses whitespace and trims", () => {
    expect(stickyPlainText("  one\n\n\ttwo   three  ")).toBe("one two three");
    expect(stickyPlainText("")).toBe("");
  });

  it("cuts at 20,000 characters without an ellipsis", () => {
    const text = stickyPlainText("x".repeat(STICKY_CONTENT_MAX_LENGTH + 50));
    expect(text).toHaveLength(STICKY_CONTENT_MAX_LENGTH);
    expect(text.endsWith("x")).toBe(true);
  });

  it("stays fast on long adversarial input", () => {
    const inputs = [
      "\n".repeat(20_000),
      "\n \n".repeat(6_000),
      "[".repeat(20_000),
      "[](".repeat(6_666),
      "<a".repeat(10_000),
      "| a |\n".repeat(3_333),
    ];
    const started = performance.now();
    for (const input of inputs) stickyPlainText(`${input}x`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
