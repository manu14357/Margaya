import { describe, expect, it } from "vitest";
import {
  jsonToMarkdown,
  jsonToYDoc,
  markdownToJson,
  normalizeDocument,
  pageSchema,
  yDocToJson,
} from "../src/index";

function expectStable(markdown: string) {
  expect(jsonToMarkdown(markdownToJson(markdown))).toBe(markdown);
}

const ALERTS = [
  ["NOTE", "info"],
  ["WARNING", "warning"],
  ["TIP", "success"],
  ["CAUTION", "danger"],
] as const;

describe("callout markdown", () => {
  it.each(ALERTS)(
    "reads > [!%s] as a %s callout and writes it back",
    (alert, variant) => {
      const markdown = `> [!${alert}]\n> Mind the **gap**.`;
      const json = markdownToJson(markdown);
      expect(json.content).toEqual([
        {
          type: "callout",
          attrs: { variant },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Mind the " },
                { type: "text", text: "gap", marks: [{ type: "bold" }] },
                { type: "text", text: "." },
              ],
            },
          ],
        },
      ]);
      expect(jsonToMarkdown(json)).toBe(markdown);
    },
  );

  it("keeps several blocks, lists included, inside one callout", () => {
    const markdown = [
      "> [!WARNING]",
      "> First paragraph.",
      ">",
      "> - one",
      "> - two",
      ">",
      "> 1. first",
      "> 2. second",
    ].join("\n");
    const json = markdownToJson(markdown);
    expect(json.content?.length).toBe(1);
    expect(json.content?.[0]?.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "bulletList",
      "orderedList",
    ]);
    expectStable(markdown);
  });

  it("reads the alert keyword in any case and IMPORTANT as info", () => {
    expect(markdownToJson("> [!tip]\n> x").content?.[0]?.attrs).toEqual({
      variant: "success",
    });
    const important = markdownToJson("> [!IMPORTANT]\n> x");
    expect(important.content?.[0]?.attrs).toEqual({ variant: "info" });
    expect(jsonToMarkdown(important)).toBe("> [!NOTE]\n> x");
  });

  it("ends at the first line without a quote marker", () => {
    const json = markdownToJson("> [!NOTE]\n> inside\n\nafter");
    expect(json.content?.map((node) => node.type)).toEqual([
      "callout",
      "paragraph",
    ]);
    expectStable(jsonToMarkdown(json));
  });

  it("keeps the blocks around it", () => {
    const markdown = "# Title\n\n> [!CAUTION]\n> Careful.\n\nAfter.";
    const json = markdownToJson(markdown);
    expect(json.content?.map((node) => node.type)).toEqual([
      "heading",
      "callout",
      "paragraph",
    ]);
    expect(jsonToMarkdown(json)).toBe(markdown);
  });

  it("gives an empty callout an empty paragraph", () => {
    const json = markdownToJson("> [!NOTE]");
    expect(json.content?.[0]).toEqual({
      type: "callout",
      attrs: { variant: "info" },
      content: [{ type: "paragraph" }],
    });
    expectStable(jsonToMarkdown(json));
  });
});

describe("plain blockquotes", () => {
  it("still read as blockquotes", () => {
    const json = markdownToJson("> just a quote\n> on two lines");
    expect(json.content?.[0]?.type).toBe("blockquote");
    expectStable("> quoted text");
  });

  it("stay blockquotes when the alert marker is not on the first line", () => {
    const json = markdownToJson("> text\n> [!NOTE]");
    expect(json.content?.[0]?.type).toBe("blockquote");
  });

  it("stay blockquotes for an unknown alert keyword", () => {
    const json = markdownToJson("> [!DANGER]\n> x");
    expect(json.content?.[0]?.type).toBe("blockquote");
  });

  it("can sit inside a callout", () => {
    const markdown = "> [!TIP]\n> > quoted inside";
    const json = markdownToJson(markdown);
    expect(json.content?.[0]?.content?.[0]?.type).toBe("blockquote");
    expectStable(markdown);
  });
});

describe("callout node", () => {
  it("declares a variant attribute defaulting to info", () => {
    const type = pageSchema().nodes.callout;
    expect(type?.spec.attrs?.variant?.default).toBe("info");
    expect(type?.isBlock).toBe(true);
    expect(type?.spec.content).toBe("block+");
  });

  it("normalizes an unknown variant to info", () => {
    const json = normalizeDocument({
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { variant: "<script>", onclick: "x" },
          content: [{ type: "paragraph" }],
        },
      ],
    });
    expect(json.content?.[0]?.attrs).toEqual({ variant: "info" });
  });

  it("survives a Yjs round trip", () => {
    const json = markdownToJson(
      "> [!CAUTION]\n> Careful.\n>\n> - [ ] check\n\nAfter.",
    );
    expect(yDocToJson(jsonToYDoc(json))).toEqual(json);
  });
});
