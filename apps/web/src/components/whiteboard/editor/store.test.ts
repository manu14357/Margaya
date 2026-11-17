import { afterEach, describe, expect, it } from "vitest";
import {
  applyToolEvent,
  createEditorStore,
  DEFAULT_ITEM_STYLE,
  type EditorState,
  escapeStep,
  INITIAL_EDITOR_STATE,
  loadPrefs,
  openDialog,
  patchStyle,
  pruneSelection,
  savePrefs,
  setSelection,
  setViewport,
  toggleInSelection,
} from "./store";

afterEach(() => {
  window.localStorage.clear();
});

describe("editor store reducers", () => {
  it("keeps the same state object when the selection does not change", () => {
    const state = setSelection(INITIAL_EDITOR_STATE, ["a", "b"]);
    expect(setSelection(state, ["b", "a"])).toBe(state);
    expect(setSelection(state, ["a", "a", "b"])).toBe(state);
    expect(setSelection(state, ["a"]).selectedIds).toEqual(["a"]);
  });

  it("toggles a group of ids in and out of the selection together", () => {
    const one = setSelection(INITIAL_EDITOR_STATE, ["a"]);
    const added = toggleInSelection(one, ["b", "c"]);
    expect(added.selectedIds).toEqual(["a", "b", "c"]);
    const removed = toggleInSelection(added, ["b", "c"]);
    expect(removed.selectedIds).toEqual(["a"]);
    // A partly selected group is completed rather than flipped.
    expect(toggleInSelection(one, ["a", "d"]).selectedIds).toEqual(["a", "d"]);
  });

  it("drops ids a collaborator deleted, and the text editor with them", () => {
    const state = {
      ...setSelection(INITIAL_EDITOR_STATE, ["a", "b"]),
      editingTextId: "b",
    };
    const pruned = pruneSelection(state, (id) => id === "a");
    expect(pruned.selectedIds).toEqual(["a"]);
    expect(pruned.editingTextId).toBeNull();
    expect(pruneSelection(pruned, () => true)).toBe(pruned);
  });

  it("steps back one level per Escape", () => {
    let state: EditorState = {
      ...INITIAL_EDITOR_STATE,
      tool: "rectangle",
      selectedIds: ["a"],
      editingGroupId: "g",
      contextMenu: { clientX: 1, clientY: 2, targetId: null },
    };
    state = escapeStep(state);
    expect(state.contextMenu).toBeNull();
    state = escapeStep(state);
    expect(state.tool).toBe("select");
    state = escapeStep(state);
    expect(state.editingGroupId).toBeNull();
    state = escapeStep(state);
    expect(state.selectedIds).toEqual([]);
    expect(escapeStep(state)).toBe(state);
  });

  it("ignores a viewport that did not move", () => {
    const state = setViewport(INITIAL_EDITOR_STATE, {
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
    });
    expect(state).toBe(INITIAL_EDITOR_STATE);
    expect(
      setViewport(state, { scrollX: 5, scrollY: 0, zoom: 1 }).viewport.scrollX,
    ).toBe(5);
  });

  it("opens a dialog and closes the context menu", () => {
    const state = openDialog(
      {
        ...INITIAL_EDITOR_STATE,
        contextMenu: { clientX: 0, clientY: 0, targetId: null },
      },
      "help",
    );
    expect(state.dialog).toBe("help");
    expect(state.contextMenu).toBeNull();
  });

  it("applies tool events through the tool machine", () => {
    const picked = applyToolEvent(INITIAL_EDITOR_STATE, {
      type: "pick",
      tool: "ellipse",
      readOnly: false,
    });
    expect(picked.tool).toBe("ellipse");
    expect(applyToolEvent(picked, { type: "created" }).tool).toBe("select");
  });

  it("stores the style per browser and refuses garbage when reading it back", () => {
    const state = patchStyle(INITIAL_EDITOR_STATE, {
      strokeColor: "#ff0000",
      strokeWidth: 4,
    });
    savePrefs(state);
    expect(loadPrefs().style).toMatchObject({
      strokeColor: "#ff0000",
      strokeWidth: 4,
    });

    window.localStorage.setItem(
      "margaya-whiteboard-editor",
      JSON.stringify({
        style: {
          strokeColor: "javascript:alert(1)",
          strokeWidth: 9999,
          fontFamily: "evil",
        },
        snapToObjects: "yes",
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.style?.strokeColor).toBe(DEFAULT_ITEM_STYLE.strokeColor);
    expect(prefs.style?.strokeWidth).toBe(DEFAULT_ITEM_STYLE.strokeWidth);
    expect(prefs.style?.fontFamily).toBe(DEFAULT_ITEM_STYLE.fontFamily);
    expect(prefs.snapToObjects).toBeUndefined();

    window.localStorage.setItem("margaya-whiteboard-editor", "{not json");
    expect(loadPrefs()).toEqual({});
  });

  it("remembers pen-only mode on this device", () => {
    expect(loadPrefs().penOnly).toBeUndefined();
    savePrefs({ ...INITIAL_EDITOR_STATE, penOnly: true });
    expect(loadPrefs().penOnly).toBe(true);
    window.localStorage.setItem(
      "margaya-whiteboard-editor",
      JSON.stringify({ penOnly: "on" }),
    );
    expect(loadPrefs().penOnly).toBeUndefined();
  });

  it("creates a store seeded with preferences", () => {
    const store = createEditorStore({ showMinimap: true });
    expect(store.getState().showMinimap).toBe(true);
    expect(store.getState().tool).toBe("select");
  });
});
