import {
  createElement,
  DEFAULT_BOARD_SETTINGS,
  serializeBoard,
} from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_TYPE,
  MAX_CLIPBOARD_CHARS,
  parseClipboardText,
  serializeClipboard,
} from "./clipboard";

describe("clipboard envelope", () => {
  it("round-trips board elements through text/plain JSON", () => {
    const rect = createElement("rectangle", {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    const note = createElement("sticky", { text: "Idea" });
    const text = serializeClipboard([rect, note], "board-1");
    expect(JSON.parse(text).type).toBe(CLIPBOARD_TYPE);
    const parsed = parseClipboardText(text);
    expect(parsed.kind).toBe("elements");
    if (parsed.kind !== "elements") return;
    expect(parsed.sourceBoardId).toBe("board-1");
    expect(parsed.elements.map((element) => element.id)).toEqual(
      expect.arrayContaining([rect.id, note.id]),
    );
  });

  it("leaves deleted elements out of a copy", () => {
    const gone = { ...createElement("ellipse"), deleted: true };
    const kept = createElement("ellipse");
    const parsed = parseClipboardText(serializeClipboard([gone, kept], null));
    expect(
      parsed.kind === "elements" && parsed.elements.map((e) => e.id),
    ).toEqual([kept.id]);
  });

  it("validates every pasted element and drops unsafe values", () => {
    const text = JSON.stringify({
      type: CLIPBOARD_TYPE,
      version: 1,
      elements: [
        {
          ...createElement("text", { text: "ok" }),
          link: "javascript:alert(1)",
        },
        { id: "x", type: "unknown-thing" },
        "not an element",
      ],
    });
    const parsed = parseClipboardText(text);
    expect(parsed.kind).toBe("elements");
    if (parsed.kind !== "elements") return;
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]?.link ?? null).toBeNull();
  });

  it("accepts a whole board file", () => {
    const rect = createElement("rectangle");
    const parsed = parseClipboardText(
      serializeBoard([rect], { ...DEFAULT_BOARD_SETTINGS }),
    );
    expect(parsed.kind === "elements" && parsed.elements[0]?.id).toBe(rect.id);
  });

  it("treats anything else as text, and recognises links", () => {
    expect(parseClipboardText("hello\nworld")).toEqual({
      kind: "text",
      text: "hello\nworld",
      url: null,
    });
    expect(parseClipboardText("  https://example.com/a  ")).toEqual({
      kind: "text",
      text: "https://example.com/a",
      url: "https://example.com/a",
    });
    expect(parseClipboardText('{"type":"something-else"}').kind).toBe("text");
    expect(parseClipboardText("{broken json").kind).toBe("text");
  });

  it("ignores empty, envelope-without-elements and oversized clipboards", () => {
    expect(parseClipboardText("")).toEqual({ kind: "empty" });
    expect(parseClipboardText("   ")).toEqual({ kind: "empty" });
    expect(parseClipboardText(null)).toEqual({ kind: "empty" });
    expect(
      parseClipboardText(
        JSON.stringify({ type: CLIPBOARD_TYPE, elements: [] }),
      ),
    ).toEqual({
      kind: "empty",
    });
    expect(parseClipboardText("a".repeat(MAX_CLIPBOARD_CHARS + 1))).toEqual({
      kind: "empty",
    });
  });
});
