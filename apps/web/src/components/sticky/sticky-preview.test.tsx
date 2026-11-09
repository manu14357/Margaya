import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Extension } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommentEditor from "@/components/activity/comment-editor";
import { parseStickyPreview, StickyPreview } from "./sticky-preview";

// The real comment editor (only browser-only extensions are replaced), so the
// preview is checked against the DOM the editor itself draws.
function inert(name: string) {
  return Extension.create({ name });
}
vi.mock("@/components/task/extensions/shiki-code-block", () => ({
  ShikiCodeBlock: inert("shikiCodeBlockStub"),
  SHIKI_CODEBLOCK_REFRESH_META: "shikiRefresh",
}));
vi.mock("@/components/task/extensions/mermaid-block", () => ({
  MermaidBlock: inert("mermaidBlockStub"),
}));
vi.mock("@/lib/shiki-highlighter", () => ({
  getSharedShikiHighlighter: () => new Promise(() => {}),
}));
vi.mock("shiki", () => ({ bundledLanguages: { typescript: {} } }));
const t = (key: string) => key;
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => [],
}));
Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;

afterEach(cleanup);

// What stickies hold: plain notes and to-do lists, as typed and as the
// editor writes them back.
const DRAWN = [
  "",
  "Hello world",
  "Hello\n",
  "- [ ] ",
  "- [ ] Buy milk\n- [x] Done item",
  "- [X] cap",
  "- [ ] a\n- [ ] \n- [x] c",
  "Line one\nLine two\n\nPara two",
  "a   b  \nc",
  "x \ny",
  "# One\n## Two\n### Three",
  "## H2\n### H3\ntext after",
  "## Todo\n- [ ] a",
  "# Plan\n- a\n- b",
  "- [x] done\n- next\n\n1. one",
  "- a\n- b\n\n1. one\n2. two",
  "3. three\n4. four",
  "10. ten\n11. eleven",
  "Groceries:\n- [ ] milk\n- [x] eggs",
  "Groceries:\n\n- [ ] milk\n- [x] eggs",
  "Note\n- a",
  "A\n\nB",
  "A\n\n- b",
  "- a\n\nB",
  "# H\n\nB",
  "A\n\n# H",
  "- [ ] a\n\nB",
  "1. a\n\nB",
  "- [ ] a\n- b",
  "1. one\n- two",
  "- [ ] a\n\n- b",
  "1. one\n\n- two",
  "Done! 100% sure, 3.5 kg; a+b=c ^ {x} (ok) #5 - dash",
  "R&D plan: café — naïve 日本語 🙂 \"quoted\" 'single'",
  "Ünïcödé\n\n- [x] ✓ done",
];

// Markup, links, nesting and blank-line runs: the editor draws these.
const LEFT_TO_EDITOR = [
  "**bold**",
  "*it*",
  "`code`",
  "~~s~~",
  "snake_case",
  "[link](https://example.com)",
  "https://example.com",
  "see www.example.com",
  "mail a@b.com",
  "<b>x</b>",
  "&amp;",
  "a\\b",
  "> quote",
  "> [!NOTE]\n> hi",
  "| a | b |",
  "  indented",
  "\tTab",
  "#tag",
  "#### H4",
  "---",
  "A\n===",
  "- a\n  - nested",
  "- a\nlazy",
  "- [ ] a\nlazy",
  "Shopping\n2. eggs",
  "Para\n## H",
  "Note\n- [ ] ",
  "- a\n\n- b",
  "- [ ] a\n\n- [ ] b",
  "A\n\n\nB",
  "A\n\n\n\nB",
  "\n\nLead",
  "Trail\n\n",
  "Trail  ",
  "- ",
  "- [ ]",
  "1) one",
  "- - a",
  " ",
];

describe("parseStickyPreview", () => {
  it.each(DRAWN)("draws %j", (markdown) => {
    expect(parseStickyPreview(markdown)).not.toBeNull();
  });

  it.each(LEFT_TO_EDITOR)("leaves %j to the editor", (markdown) => {
    expect(parseStickyPreview(markdown)).toBeNull();
  });
});

/** The root's markup without what differs by instance (ids, React wrappers). */
function markup(root: Element) {
  const clone = root.cloneNode(true) as Element;
  for (const wrapper of clone.querySelectorAll(".react-renderer")) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const element of clone.querySelectorAll("[id], [as]")) {
    element.removeAttribute("id");
    element.removeAttribute("as");
  }
  return clone.innerHTML;
}

describe("StickyPreview", () => {
  it.each(DRAWN)("matches the editor's DOM for %j", async (markdown) => {
    const blocks = parseStickyPreview(markdown);
    if (!blocks) throw new Error("not drawn");

    const editor = render(
      <CommentEditor value={markdown} placeholder="PH" onChange={() => {}} />,
    );
    const editorRoot = await waitFor(() => {
      const root = editor.container.querySelector(".ProseMirror");
      if (!root) throw new Error("editor not mounted");
      return root;
    });
    // Content and node views settle a tick after the editor mounts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const preview = render(<StickyPreview blocks={blocks} placeholder="PH" />);
    const previewRoot = preview.container.querySelector(
      "[data-sticky-preview]",
    );
    if (!previewRoot) throw new Error("preview not rendered");

    expect(markup(previewRoot)).toBe(markup(editorRoot));
    expect(
      previewRoot.closest(".margaya-comment-editor-content"),
    ).not.toBeNull();
    expect(previewRoot.classList).toContain("ProseMirror");
    expect(previewRoot.classList).toContain("margaya-comment-editor-prose");
  });

  it("reports to-do clicks by their index in the sticky", async () => {
    const onToggleTask = vi.fn();
    const blocks = parseStickyPreview("- [ ] a\n\nmid\n\n- [ ] b\n- [x] c");
    if (!blocks) throw new Error("not drawn");
    const view = render(
      <StickyPreview
        blocks={blocks}
        placeholder="PH"
        checkedOverrides={new Map([[1, true]])}
        onToggleTask={onToggleTask}
      />,
    );
    const boxes = view.getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "true",
    ]);
    act(() => boxes[2].click());
    expect(onToggleTask).toHaveBeenCalledWith(2, false);
  });
});
