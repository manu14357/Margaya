import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  jsonToMarkdown,
  markdownToJson,
  normalizeDocument,
  pageSchema,
} from "../src/index";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8").replace(/\r\n/g, "\n");
}

/** Markdown the serializer already produced: parsing it back changes nothing. */
function expectStable(markdown: string) {
  expect(jsonToMarkdown(markdownToJson(markdown))).toBe(markdown);
}

const STANDARD_MARKDOWN = [
  "# Heading 1",
  "## Heading 2",
  "### Heading 3",
  "Some **bold**, *italic*, ++under++, ~~strike~~, `code` and [a link](https://example.com).",
  "- one\n- two\n  - nested",
  "1. first\n2. second",
  "- [ ] open\n- [x] done\n  - [ ] nested task",
  "> quoted text",
  "---",
  "![alt text](https://example.com/a.png)",
  "```ts\nconst a = 1;\n```",
  "```mermaid\ngraph TD\n  A --> B\n```",
].join("\n\n");

describe("markdown round trip", () => {
  it("keeps every standard block and mark", () => {
    const json = markdownToJson(STANDARD_MARKDOWN);
    const types = (json.content ?? []).map((node) => node.type);
    expect(types).toEqual([
      "heading",
      "heading",
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "horizontalRule",
      "image",
      "codeBlock",
      "codeBlock",
    ]);
    const marks = new Set(
      (json.content?.[3]?.content ?? []).flatMap((node) =>
        (node.marks ?? []).map((mark) => mark.type),
      ),
    );
    expect([...marks].sort()).toEqual([
      "bold",
      "code",
      "italic",
      "link",
      "strike",
      "underline",
    ]);
    expect(json.content?.[11]?.attrs?.language).toBe("mermaid");
    expect(jsonToMarkdown(json)).toBe(STANDARD_MARKDOWN);
  });

  it("keeps tables", () => {
    const markdown = "| a   | b   |\n| --- | --- |\n| 1   | 2   |";
    const json = markdownToJson(markdown);
    expect(json.content?.[0]?.type).toBe("table");
    expectStable(jsonToMarkdown(json));
  });

  it("normalizes the input, then stays stable", () => {
    const loose =
      "Title\n=====\n\n* a\n* b\n\n\n\n| x | y |\n|---|---|\n| 1 | 2 |\n";
    const normalized = jsonToMarkdown(markdownToJson(loose));
    expect(normalized.startsWith("# Title\n\n- a\n- b")).toBe(true);
    expectStable(normalized);
  });

  it("reads each custom tag, unescaping its attributes", () => {
    const json = markdownToJson(readFixture("custom-nodes.md"));
    const expected = normalizeDocument(
      JSON.parse(readFixture("custom-nodes.json")),
    );
    // A mention without an id is written as plain "@label" text.
    const paragraph = expected.content?.[0]?.content ?? [];
    paragraph.splice(2, 3, { type: "text", text: " and @someone, see " });
    expect(json).toEqual(expected);
  });

  it("keeps unknown tags as literal text", () => {
    const json = markdownToJson('Hi <margaya-unknown a="1"></margaya-unknown>');
    expect(JSON.stringify(json)).toContain("margaya-unknown");
    expect(JSON.stringify(json)).not.toContain('"type":"margayaMention"');
  });

  it("reads a task link or attachment written inside a paragraph", () => {
    const json = markdownToJson(
      'See <margaya-issue-link url="https://x.test/t" issue-key="WEB-1" task-id="t1" /> now',
    );
    const inline = json.content?.[0]?.content ?? [];
    expect(inline.map((node) => node.type)).toEqual([
      "text",
      "margayaIssueLink",
      "text",
    ]);
    expect(inline[1]?.attrs).toEqual({
      url: "https://x.test/t",
      issueKey: "WEB-1",
      taskId: "t1",
    });
  });

  it("keeps an empty paragraph between two standalone tags", () => {
    const attachment = (url: string) => ({
      type: "paragraph",
      content: [
        {
          type: "attachmentCard",
          attrs: { url, filename: "f", mimeType: "", size: 1 },
        },
      ],
    });
    const json = normalizeDocument({
      type: "doc",
      content: [
        attachment("https://x.test/a"),
        { type: "paragraph" },
        attachment("https://x.test/b"),
      ],
    });
    expect(markdownToJson(jsonToMarkdown(json))).toEqual(json);
  });

  it("gives an empty document one empty paragraph and empty markdown", () => {
    const json = markdownToJson("");
    expect(json).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(jsonToMarkdown(json)).toBe("");
  });
});

describe("custom node renderers", () => {
  it("render byte-identical to the shared fixture", () => {
    const json = JSON.parse(readFixture("custom-nodes.json"));
    expect(jsonToMarkdown(json)).toBe(readFixture("custom-nodes.md"));
  });

  it("round trip the fixture markdown unchanged", () => {
    expectStable(readFixture("custom-nodes.md"));
  });

  it("declare the web node names, flags and attributes", () => {
    const { nodes } = pageSchema();
    const shape = (name: string) => {
      const type = nodes[name];
      if (!type) throw new Error(`missing node ${name}`);
      return {
        inline: type.isInline,
        atom: type.isAtom,
        attrs: Object.fromEntries(
          Object.entries(type.spec.attrs ?? {}).map(([key, spec]) => [
            key,
            spec.default,
          ]),
        ),
      };
    };
    expect(shape("margayaMention")).toEqual({
      inline: true,
      atom: true,
      attrs: { id: "", label: "" },
    });
    expect(shape("margayaIssueLink")).toEqual({
      inline: true,
      atom: true,
      attrs: { url: "", issueKey: "", taskId: "" },
    });
    expect(shape("attachmentCard")).toEqual({
      inline: true,
      atom: true,
      attrs: { url: "", filename: "", mimeType: "", size: 0 },
    });
    expect(shape("embedBlock")).toEqual({
      inline: false,
      atom: true,
      attrs: { url: "", mode: "embed" },
    });
    expect(shape("margayaPageLink")).toEqual({
      inline: true,
      atom: true,
      attrs: { pageId: "", title: "" },
    });
  });

  it("write an embed with an invalid url like the web", () => {
    const markdown = jsonToMarkdown({
      type: "doc",
      content: [
        { type: "embedBlock", attrs: { url: "not a url", mode: "embed" } },
      ],
    });
    expect(markdown).toBe(
      '\n<span class="margaya-embed-invalid-link">not a url</span>\n',
    );
  });
});
