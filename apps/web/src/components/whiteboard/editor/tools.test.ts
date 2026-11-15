import { describe, expect, it } from "vitest";
import {
  clearsSelection,
  INITIAL_TOOL_STATE,
  isToolAllowed,
  type ToolId,
  type ToolState,
  toolForKey,
  toolReducer,
} from "./tools";

const pick = (state: ToolState, tool: ToolId, readOnly = false) =>
  toolReducer(state, { type: "pick", tool, readOnly });

describe("tool state machine", () => {
  it("returns to Select after one shape unless the tool is locked", () => {
    const rectangle = pick(INITIAL_TOOL_STATE, "rectangle");
    expect(rectangle.tool).toBe("rectangle");
    expect(toolReducer(rectangle, { type: "created" }).tool).toBe("select");

    const locked = toolReducer(rectangle, { type: "toggleLock" });
    expect(locked.locked).toBe(true);
    expect(toolReducer(locked, { type: "created" }).tool).toBe("rectangle");
  });

  it("keeps the pen, eraser, laser and hand active after each use", () => {
    for (const tool of ["draw", "eraser", "laser", "hand"] as const) {
      const state = pick(INITIAL_TOOL_STATE, tool);
      expect(toolReducer(state, { type: "created" }).tool).toBe(tool);
    }
  });

  it("opens dialogs for the image and task tools without switching the canvas tool", () => {
    const state = pick(INITIAL_TOOL_STATE, "arrow");
    expect(pick(state, "image")).toBe(state);
    expect(pick(state, "task")).toBe(state);
  });

  it("allows only select, hand and laser on a read-only board", () => {
    expect(pick(INITIAL_TOOL_STATE, "rectangle", true)).toBe(
      INITIAL_TOOL_STATE,
    );
    expect(pick(INITIAL_TOOL_STATE, "hand", true).tool).toBe("hand");
    expect(pick(INITIAL_TOOL_STATE, "laser", true).tool).toBe("laser");
    expect(isToolAllowed("eraser", true)).toBe(false);
    expect(isToolAllowed("eraser", false)).toBe(true);
  });

  it("holds the hand while Space is down and resumes the previous tool", () => {
    const text = pick(INITIAL_TOOL_STATE, "text");
    const held = toolReducer(text, { type: "holdHand" });
    expect(held.tool).toBe("hand");
    // Key repeat must not overwrite the tool to come back to.
    expect(toolReducer(held, { type: "holdHand" })).toBe(held);
    expect(toolReducer(held, { type: "releaseHand" }).tool).toBe("text");
    expect(toolReducer(text, { type: "releaseHand" })).toBe(text);
  });

  it("cancels back to Select", () => {
    const state = pick(INITIAL_TOOL_STATE, "frame");
    expect(toolReducer(state, { type: "cancel" }).tool).toBe("select");
    expect(toolReducer(INITIAL_TOOL_STATE, { type: "cancel" })).toBe(
      INITIAL_TOOL_STATE,
    );
  });

  it("maps single keys to tools", () => {
    expect(toolForKey("V")).toBe("select");
    expect(toolForKey("1")).toBe("select");
    expect(toolForKey("r")).toBe("rectangle");
    expect(toolForKey("s")).toBe("sticky");
    expect(toolForKey("0")).toBe("eraser");
    expect(toolForKey("k")).toBe("laser");
    expect(toolForKey("z")).toBeNull();
  });

  it("clears the selection only for creation tools", () => {
    expect(clearsSelection("rectangle")).toBe(true);
    expect(clearsSelection("select")).toBe(false);
    expect(clearsSelection("hand")).toBe(false);
  });
});
