import type { ShapeKind } from "@margaya/whiteboard";

// The tools and the small state machine that decides which tool is active
// after each step. Pure, so the toolbar, the shortcuts and the tests agree.

export const TOOL_IDS = [
  "select",
  "hand",
  "rectangle",
  "diamond",
  "ellipse",
  "shape",
  "arrow",
  "line",
  "draw",
  "text",
  "sticky",
  "image",
  "eraser",
  "frame",
  "laser",
  "task",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** Tools that create a box-shaped element by dragging. */
export const BOX_TOOLS = [
  "rectangle",
  "diamond",
  "ellipse",
  "shape",
  "frame",
  "sticky",
] as const satisfies readonly ToolId[];
export type BoxTool = (typeof BOX_TOOLS)[number];

/**
 * Everything the shape picker offers: the three classic shapes, which keep
 * their own element types and tools, and the outlines of the `shape` type.
 */
export type ShapeChoice = "rectangle" | "ellipse" | "diamond" | ShapeKind;

const CLASSIC_SHAPES: ReadonlySet<ToolId | ShapeChoice> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
]);

export function isClassicShape(
  choice: ShapeChoice,
): choice is "rectangle" | "ellipse" | "diamond" {
  return CLASSIC_SHAPES.has(choice);
}

/** The tool that draws a picked shape. */
export function toolForShape(choice: ShapeChoice): BoxTool {
  return isClassicShape(choice) ? choice : "shape";
}

/** Tools the toolbar's shape button stands for. */
export function isShapeTool(tool: ToolId): boolean {
  return tool === "shape" || CLASSIC_SHAPES.has(tool);
}

export const LINEAR_TOOLS = [
  "arrow",
  "line",
] as const satisfies readonly ToolId[];

/** Tools that work without write access. */
const READ_ONLY_TOOLS: ReadonlySet<ToolId> = new Set([
  "select",
  "hand",
  "laser",
]);

/**
 * Tools that keep themselves active after use: drawing several strokes or
 * erasing several things in a row is the normal way to use them.
 */
const STICKY_TOOLS: ReadonlySet<ToolId> = new Set([
  "hand",
  "draw",
  "eraser",
  "laser",
  "select",
]);

/** Tools that open a dialog instead of acting on the canvas. */
const DIALOG_TOOLS: ReadonlySet<ToolId> = new Set(["image", "task"]);

/** Single-key shortcuts, matched without modifiers (see shortcuts.ts). */
export const TOOL_SHORTCUTS: Record<ToolId, readonly string[]> = {
  select: ["v", "1"],
  hand: ["h"],
  rectangle: ["r", "2"],
  diamond: ["d", "3"],
  ellipse: ["o", "4"],
  shape: [],
  arrow: ["a", "5"],
  line: ["l", "6"],
  draw: ["p", "7"],
  text: ["t", "8"],
  sticky: ["s"],
  image: ["9"],
  eraser: ["e", "0"],
  frame: ["f"],
  laser: ["k"],
  task: [],
};

export type ToolState = {
  tool: ToolId;
  /** Keep the current creation tool after each new element. */
  locked: boolean;
  /** The tool to return to when a temporary hand (Space) is released. */
  resumeTool: ToolId | null;
};

export const INITIAL_TOOL_STATE: ToolState = {
  tool: "select",
  locked: false,
  resumeTool: null,
};

export function isToolAllowed(tool: ToolId, readOnly: boolean): boolean {
  return !readOnly || READ_ONLY_TOOLS.has(tool);
}

export function isDialogTool(tool: ToolId): boolean {
  return DIALOG_TOOLS.has(tool);
}

export function isBoxTool(tool: ToolId): tool is BoxTool {
  return (BOX_TOOLS as readonly ToolId[]).includes(tool);
}

export function isLinearTool(tool: ToolId): tool is "arrow" | "line" {
  return tool === "arrow" || tool === "line";
}

/** Whether picking this tool should drop the current selection. */
export function clearsSelection(tool: ToolId): boolean {
  return tool !== "select" && tool !== "hand" && tool !== "laser";
}

export type ToolEvent =
  | { type: "pick"; tool: ToolId; readOnly: boolean }
  | { type: "toggleLock" }
  | { type: "created" }
  | { type: "cancel" }
  | { type: "holdHand" }
  | { type: "releaseHand" };

export function toolReducer(state: ToolState, event: ToolEvent): ToolState {
  switch (event.type) {
    case "pick": {
      if (!isToolAllowed(event.tool, event.readOnly)) return state;
      // Dialog tools open their dialog; the canvas tool stays as it was.
      if (isDialogTool(event.tool)) return state;
      return { ...state, tool: event.tool, resumeTool: null };
    }
    case "toggleLock":
      return { ...state, locked: !state.locked };
    case "created":
      if (state.locked || STICKY_TOOLS.has(state.tool)) return state;
      return { ...state, tool: "select" };
    case "cancel":
      if (state.tool === "select") return state;
      return { ...state, tool: "select", resumeTool: null };
    case "holdHand":
      if (state.tool === "hand" || state.resumeTool) return state;
      return { ...state, tool: "hand", resumeTool: state.tool };
    case "releaseHand":
      if (!state.resumeTool) return state;
      return { ...state, tool: state.resumeTool, resumeTool: null };
  }
}

/** The tool a single key press picks, or null. */
export function toolForKey(key: string): ToolId | null {
  const lower = key.toLowerCase();
  for (const id of TOOL_IDS) {
    if (TOOL_SHORTCUTS[id].includes(lower)) return id;
  }
  return null;
}
