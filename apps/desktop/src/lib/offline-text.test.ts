import { describe, expect, it } from "vitest";
import { parseOfflineText } from "./offline-text";

describe("parseOfflineText", () => {
  it("reads headings, lists, checklists and paragraphs", () => {
    expect(
      parseOfflineText(
        "# Plan\nFirst line\nsecond line\n\n- one\n* two\n1. three\n- [ ] open\n- [x] done\n#### Deep",
      ),
    ).toEqual([
      { type: "heading", level: 1, text: "Plan" },
      { type: "paragraph", lines: ["First line", "second line"] },
      { type: "item", marker: "•", checked: null, text: "one" },
      { type: "item", marker: "•", checked: null, text: "two" },
      { type: "item", marker: "1.", checked: null, text: "three" },
      { type: "item", marker: "", checked: false, text: "open" },
      { type: "item", marker: "", checked: true, text: "done" },
      { type: "heading", level: 3, text: "Deep" },
    ]);
  });

  it("keeps markup-looking text as text", () => {
    expect(
      parseOfflineText("<img src=x onerror=alert(1)>\r\n#not a heading"),
    ).toEqual([
      {
        type: "paragraph",
        lines: ["<img src=x onerror=alert(1)>", "#not a heading"],
      },
    ]);
    expect(parseOfflineText("")).toEqual([]);
  });
});
