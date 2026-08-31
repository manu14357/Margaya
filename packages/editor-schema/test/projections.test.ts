import { describe, expect, it } from "vitest";
import {
  jsonToPlainText,
  markdownToJson,
  referencesFromJson,
} from "../src/index";

const DOCUMENT = markdownToJson(
  [
    "# Launch plan",
    'Hello <margaya-mention id="u1" label="Ann"></margaya-mention>, see <margaya-page-link id="p2" title="Specs"></margaya-page-link> and <margaya-page-link id="self" title="This page"></margaya-page-link>.',
    '<margaya-issue-link url="https://x.test/t1" issue-key="WEB-1" task-id="t1" />',
    '<margaya-issue-link url="https://x.test/t2" issue-key="WEB-2" task-id="" />',
    '- [ ] ask <margaya-mention id="u2" label="Bo"></margaya-mention>\n- [x] repeat <margaya-mention id="u1" label="Ann"></margaya-mention>',
    "",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
  ].join("\n\n"),
);

describe("plain text", () => {
  it("keeps one line per block around images and inside callouts", () => {
    const json = markdownToJson(
      [
        "> [!TIP]\n> Mind the **gap**.\n>\n> - one",
        "![Plan](https://x.test/a.png)",
        '<img src="https://x.test/b.png" alt="" width="50%" />',
        "After.",
      ].join("\n\n"),
    );
    expect(jsonToPlainText(json)).toBe("Mind the gap.\none\nAfter.");
  });

  it("joins blocks with newlines, with @labels, task keys and page titles", () => {
    expect(jsonToPlainText(DOCUMENT)).toBe(
      [
        "Launch plan",
        "Hello @Ann, see Specs and This page.",
        "WEB-1",
        "WEB-2",
        "ask @Bo",
        "repeat @Ann",
        "a",
        "b",
        "1",
        "2",
      ].join("\n"),
    );
  });

  it("is empty for an empty document", () => {
    expect(jsonToPlainText(markdownToJson(""))).toBe("");
  });
});

describe("references", () => {
  it("lists users, tasks and pages once each, ignoring self-links", () => {
    expect(referencesFromJson(DOCUMENT, { selfPageId: "self" })).toEqual({
      userIds: ["u1", "u2"],
      taskIds: ["t1"],
      taskKeys: ["WEB-2"],
      pageIds: ["p2"],
    });
  });

  it("keeps the self-link when no page id is given", () => {
    expect(referencesFromJson(DOCUMENT).pageIds).toEqual(["p2", "self"]);
  });

  it("ignores mentions without an id", () => {
    const json = markdownToJson("Hi @someone");
    expect(referencesFromJson(json).userIds).toEqual([]);
  });
});
