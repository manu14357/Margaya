import { describe, expect, it } from "vitest";
import { jiraWikiToMarkdown } from "../../../apps/api/src/jira-import/wiki-markup";

const CASES: Array<[string, string, string]> = [
  ["heading 1", "h1. Title", "# Title"],
  ["heading 3", "h3. Section", "### Section"],
  ["heading 5 caps at 3", "h5. Deep", "### Deep"],
  ["bold", "a *bold* word", "a **bold** word"],
  ["italic", "an _italic_ word", "an *italic* word"],
  ["strike", "a -gone- word", "a ~~gone~~ word"],
  ["underline", "an +under+ word", "an ++under++ word"],
  ["hyphenated words stay", "well-known self-made", "well-known self-made"],
  ["snake_case stays", "use some_var_name here", "use some_var_name here"],
  ["monospace", "run {{npm test}} now", "run `npm test` now"],
  ["monospace keeps markup", "{{*not bold*}}", "`*not bold*`"],
  ["citation", "??Someone??", "*Someone*"],
  ["superscript text kept", "x ^2^ y", "x 2 y"],
  [
    "link with text",
    "see [the docs|https://example.com/a_b-c]",
    "see [the docs](https://example.com/a_b-c)",
  ],
  ["bare link", "[https://example.com]", "<https://example.com>"],
  [
    "bare url keeps dashes",
    "go to https://example.com/-x-/a_b_",
    "go to https://example.com/-x-/a_b_",
  ],
  ["mention", "ping [~ada]", "ping @ada"],
  ["attachment link", "see [^report.pdf]", "see report.pdf"],
  ["image placeholder", "!screenshot.png!", "\\[image: screenshot.png\\]"],
  [
    "image with options",
    "!https://x.test/a/diagram.png|thumbnail!",
    "\\[image: diagram.png\\]",
  ],
  ["exclamations stay", "Wow! Great!", "Wow! Great!"],
  ["bullet list", "* one\n* two", "- one\n- two"],
  ["numbered list", "# one\n# two", "1. one\n1. two"],
  ["nested bullets", "* a\n** b\n*** c", "- a\n  - b\n    - c"],
  ["mixed nesting", "# a\n#* b\n# c", "1. a\n   - b\n1. c"],
  ["dash list", "- one\n- two", "- one\n- two"],
  ["bold at line start is not a list", "*Note:* read", "**Note:** read"],
  ["rule", "a\n----\nb", "a\n\n---\n\nb"],
  ["block quote line", "bq. quoted", "> quoted"],
  [
    "quote block",
    "{quote}line *one*\nline two{quote}",
    "> line **one**\n> line two",
  ],
  [
    "code block with language",
    "{code:java}\nint a = 1; // *x*\n{code}",
    "```java\nint a = 1; // *x*\n```",
  ],
  [
    "code block with title only",
    "{code:title=A.java|borderStyle=solid}\nx\n{code}",
    "```\nx\n```",
  ],
  [
    "noformat",
    "{noformat}\n*raw* _text_\n{noformat}",
    "```\n*raw* _text_\n```",
  ],
  [
    "table",
    "||Name||Value||\n|a|*1*|\n|b|[link|https://x.test]|",
    "| Name | Value |\n| --- | --- |\n| a | **1** |\n| b | [link](https://x.test) |",
  ],
  ["table without header", "|a|b|", "|  |  |\n| --- | --- |\n| a | b |"],
  ["colour macro dropped", "{color:red}alert{color}", "alert"],
  ["line break", "one\\\\two", "one\ntwo"],
  ["empty", "", ""],
];

describe("Jira wiki markup → Markdown", () => {
  it.each(CASES)("%s", (_, input, expected) => {
    expect(jiraWikiToMarkdown(input)).toBe(expected);
  });

  it("converts a realistic description", () => {
    const input = [
      "h2. Steps",
      "# Open the *login* page",
      "# Enter {{admin}}",
      "",
      "h2. Result",
      "Fails with -500- 502, see [log|https://logs.test/1].",
      "!error.png!",
    ].join("\r\n");
    expect(jiraWikiToMarkdown(input)).toBe(
      [
        "## Steps",
        "1. Open the **login** page",
        "1. Enter `admin`",
        "",
        "## Result",
        "Fails with ~~500~~ 502, see [log](https://logs.test/1).",
        "\\[image: error.png\\]",
      ].join("\n"),
    );
  });
});
