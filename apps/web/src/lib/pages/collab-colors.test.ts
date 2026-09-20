import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  COLLAB_COLOR_KEYS,
  caretAwarenessStates,
  caretColorValue,
  collabColorKey,
  collabColorValue,
  isCollabColorKey,
  withCaretColors,
} from "./collab-colors";

describe("collab colors", () => {
  it("gives a user the same palette key every time", () => {
    const first = collabColorKey("user_123");
    expect(collabColorKey("user_123")).toBe(first);
    expect(COLLAB_COLOR_KEYS).toContain(first);
  });

  it("spreads users over the palette", () => {
    const keys = new Set(
      Array.from({ length: 64 }, (_, index) => collabColorKey(`user-${index}`)),
    );
    expect(keys.size).toBeGreaterThan(4);
  });

  it("renders a palette variable with a fallback, never raw input", () => {
    expect(collabColorValue("teal")).toBe("var(--color-teal-500, #14b8a6)");
    expect(isCollabColorKey("teal")).toBe(true);
    expect(isCollabColorKey("#ff0000")).toBe(false);
  });
});

describe("caret colors", () => {
  const hex = /^#[0-9a-fA-F]{6}$/;

  it("maps palette keys to hex for rendering without touching the live states", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { id: "user_1", color: "teal" });
    const caret = withCaretColors(awareness);

    const local = caret.getStates().get(doc.clientID);
    expect(local?.user).toEqual({
      id: "user_1",
      color: "#14b8a6",
      colorKey: "teal",
    });
    expect(awareness.getLocalState()?.user).toEqual({
      id: "user_1",
      color: "teal",
    });

    // Writes and listeners go to the live awareness.
    caret.setLocalStateField("cursor", { anchor: 1 });
    expect(awareness.getLocalState()?.cursor).toEqual({ anchor: 1 });
    expect(caret.getLocalState()).toBe(awareness.getLocalState());
    doc.destroy();
  });

  it("derives a color from the id when the key is missing or unknown", () => {
    const states = new Map<number, Record<string, unknown> | null>([
      [1, { user: { id: "user_2", color: "#ff0000" } }],
      [2, { user: { id: "user_3" } }],
      [3, { cursor: null }],
      [4, null],
    ]);
    const mapped = caretAwarenessStates(states);
    for (const clientId of [1, 2]) {
      const user = mapped.get(clientId)?.user as Record<string, unknown>;
      expect(user.color).toMatch(hex);
      expect(isCollabColorKey(user.colorKey)).toBe(true);
    }
    expect(mapped.get(3)).toBe(states.get(3));
    expect(mapped.get(4)).toBeNull();
  });

  it("renders carets with the palette variable", () => {
    expect(caretColorValue({ id: "x", colorKey: "rose" })).toBe(
      "var(--color-rose-500, #f43f5e)",
    );
    expect(caretColorValue({ id: "user_4" })).toBe(
      collabColorValue(collabColorKey("user_4")),
    );
  });
});
