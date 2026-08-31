import { describe, expect, it } from "vitest";
import { blockWindow, paragraphWindow } from "../src/bounded-marked";
import { jsonToMarkdown, markdownToJson } from "../src/index";

describe("bounded block tokenizers", () => {
  it("ends a paragraph window at the first blank line", () => {
    expect(paragraphWindow("a\nb\n\nc\n")).toBe("a\nb\n\n");
    expect(paragraphWindow("a\nb")).toBe("a\nb");
  });

  it("keeps a whole list, loose items and indented content included", () => {
    const list = "1. one\n\n2. two\n   more\n\n   para\n3. three\nlazy\n";
    expect(blockWindow(`${list}\nafter\n`)).toBe(`${list}\n`);
  });

  it("ends a list window at an item of the other kind", () => {
    expect(blockWindow("- a\n- b\n1. c\n")).toBe("- a\n- b\n");
    expect(blockWindow("1. a\n- b\n")).toBe("1. a\n");
  });

  it("parses the same lists and tables as before", () => {
    const markdown = [
      "1. one\n2. two\n   1. nested\n3. three",
      "- [ ] open\n- [x] done",
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
      "Text after.",
    ].join("\n\n");
    const json = markdownToJson(markdown);
    expect((json.content ?? []).map((node) => node.type)).toEqual([
      "orderedList",
      "taskList",
      "table",
      "paragraph",
    ]);
    expect(markdownToJson(jsonToMarkdown(json))).toEqual(json);
  });

  it("parses many short paragraphs in linear time", () => {
    const started = Date.now();
    const json = markdownToJson(Array(20000).fill("a").join("\n\n"));
    expect(json.content).toHaveLength(20000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
