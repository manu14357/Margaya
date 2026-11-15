import { type ToolId, toolForKey } from "./tools";

// Keyboard map. One table drives the key handler and the help dialog, so a
// shortcut cannot work without being listed (or the other way round).

export type CommandId =
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "selectAll"
  | "deselect"
  | "group"
  | "ungroup"
  | "bringForward"
  | "sendBackward"
  | "bringToFront"
  | "sendToBack"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "zoomFit"
  | "zoomSelection"
  | "toggleGrid"
  | "toggleSnap"
  | "search"
  | "help"
  | "toggleToolLock"
  | "toggleElementLock"
  | "flipHorizontal"
  | "flipVertical"
  | "copyStyle"
  | "pasteStyle"
  | "alignLeft"
  | "alignRight"
  | "alignTop"
  | "alignBottom"
  | "editText"
  | "toggleMinimap"
  | "shapePicker";

export type KeyAction =
  | { kind: "command"; command: CommandId }
  | { kind: "tool"; tool: ToolId }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "flowchart"; direction: "up" | "down" | "left" | "right" }
  /** Alt+Arrow: select the next or previous element, for keyboard users. */
  | { kind: "cycle"; step: 1 | -1 };

export type KeyInput = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

type Binding = {
  command: CommandId;
  /** Lower-case `key`, or a `code` when the key differs per layout. */
  key?: string;
  code?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

const BINDINGS: readonly Binding[] = [
  { command: "undo", key: "z", mod: true },
  { command: "redo", key: "z", mod: true, shift: true },
  { command: "redo", key: "y", mod: true },
  { command: "copy", key: "c", mod: true },
  { command: "cut", key: "x", mod: true },
  { command: "duplicate", key: "d", mod: true },
  { command: "delete", key: "delete" },
  { command: "delete", key: "backspace" },
  { command: "selectAll", key: "a", mod: true },
  { command: "deselect", key: "escape" },
  { command: "group", key: "g", mod: true },
  { command: "ungroup", key: "g", mod: true, shift: true },
  { command: "bringForward", code: "BracketRight", mod: true },
  { command: "sendBackward", code: "BracketLeft", mod: true },
  { command: "bringToFront", code: "BracketRight", mod: true, shift: true },
  { command: "sendToBack", code: "BracketLeft", mod: true, shift: true },
  { command: "zoomIn", code: "Equal", mod: true },
  { command: "zoomIn", code: "NumpadAdd", mod: true },
  { command: "zoomIn", code: "Equal", mod: true, shift: true },
  { command: "zoomOut", code: "Minus", mod: true },
  { command: "zoomOut", code: "NumpadSubtract", mod: true },
  { command: "zoomReset", code: "Digit0", mod: true },
  { command: "zoomReset", code: "Numpad0", mod: true },
  { command: "zoomFit", code: "Digit1", shift: true },
  { command: "zoomSelection", code: "Digit2", shift: true },
  { command: "toggleGrid", code: "Quote", mod: true },
  { command: "toggleSnap", code: "KeyS", alt: true },
  { command: "search", key: "f", mod: true },
  { command: "help", key: "?", shift: true },
  { command: "help", code: "Slash", shift: true },
  { command: "toggleToolLock", key: "q" },
  { command: "toggleElementLock", key: "l", mod: true, shift: true },
  { command: "flipHorizontal", key: "h", shift: true },
  { command: "flipVertical", key: "v", shift: true },
  { command: "copyStyle", code: "KeyC", mod: true, alt: true },
  { command: "pasteStyle", code: "KeyV", mod: true, alt: true },
  { command: "alignLeft", key: "arrowleft", mod: true, shift: true },
  { command: "alignRight", key: "arrowright", mod: true, shift: true },
  { command: "alignTop", key: "arrowup", mod: true, shift: true },
  { command: "alignBottom", key: "arrowdown", mod: true, shift: true },
  { command: "editText", key: "enter" },
  { command: "toggleMinimap", code: "KeyM", alt: true },
  { command: "shapePicker", key: "s", shift: true },
];

/** Board units moved per arrow press, and with Shift. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

const ARROWS: Record<
  string,
  [number, number, "up" | "down" | "left" | "right"]
> = {
  arrowup: [0, -1, "up"],
  arrowdown: [0, 1, "down"],
  arrowleft: [-1, 0, "left"],
  arrowright: [1, 0, "right"],
};

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(
    navigator.platform || navigator.userAgent,
  );
}

function matches(binding: Binding, input: KeyInput, mac: boolean): boolean {
  const mod = mac ? Boolean(input.metaKey) : Boolean(input.ctrlKey);
  if (Boolean(binding.mod) !== mod) return false;
  // The other platform modifier must not be held either, so Ctrl+Z on a
  // Mac is left to the system.
  if (mac ? input.ctrlKey : input.metaKey) return false;
  if (Boolean(binding.alt) !== Boolean(input.altKey)) return false;
  const key = input.key.toLowerCase();
  if (binding.code) {
    if (input.code !== binding.code) return false;
  } else if (binding.key) {
    // `?` already implies Shift; letters must match it exactly.
    const shiftMatters =
      binding.key.length !== 1 || /[a-z0-9]/.test(binding.key);
    if (key !== binding.key) return false;
    if (shiftMatters && Boolean(binding.shift) !== Boolean(input.shiftKey))
      return false;
    return true;
  }
  return Boolean(binding.shift) === Boolean(input.shiftKey);
}

/** What a key press means on the canvas, or null to let it through. */
export function resolveKey(
  input: KeyInput,
  mac = isMacPlatform(),
): KeyAction | null {
  const key = input.key.toLowerCase();
  const mod = mac ? Boolean(input.metaKey) : Boolean(input.ctrlKey);
  const arrow = ARROWS[key];
  if (arrow && input.altKey && !mod && !input.shiftKey) {
    return { kind: "cycle", step: arrow[0] + arrow[1] > 0 ? 1 : -1 };
  }
  if (arrow && !input.altKey) {
    if (mod && !input.shiftKey)
      return { kind: "flowchart", direction: arrow[2] };
    if (!mod) {
      const step = input.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      return { kind: "nudge", dx: arrow[0] * step, dy: arrow[1] * step };
    }
  }
  for (const binding of BINDINGS) {
    if (matches(binding, input, mac))
      return { kind: "command", command: binding.command };
  }
  if (
    !mod &&
    !input.altKey &&
    !input.shiftKey &&
    !input.metaKey &&
    !input.ctrlKey
  ) {
    // Digits by code so number rows on other layouts pick tools too.
    const digit = input.code?.startsWith("Digit") ? input.code.slice(5) : null;
    const tool = toolForKey(digit ?? key);
    if (tool) return { kind: "tool", tool };
  }
  return null;
}

/** Commands that change the board, refused in read-only mode. */
const WRITE_COMMANDS: ReadonlySet<CommandId> = new Set([
  "undo",
  "redo",
  "cut",
  "paste",
  "duplicate",
  "delete",
  "group",
  "ungroup",
  "bringForward",
  "sendBackward",
  "bringToFront",
  "sendToBack",
  "toggleGrid",
  "toggleElementLock",
  "flipHorizontal",
  "flipVertical",
  "pasteStyle",
  "alignLeft",
  "alignRight",
  "alignTop",
  "alignBottom",
  "editText",
  "shapePicker",
]);

export function isWriteAction(action: KeyAction): boolean {
  switch (action.kind) {
    case "command":
      return WRITE_COMMANDS.has(action.command);
    case "nudge":
    case "flowchart":
      return true;
    case "tool":
    case "cycle":
      return false;
  }
}

/** Rows of the help dialog: a label key and the keys to show. */
export type ShortcutRow = { labelKey: string; keys: readonly string[][] };

export type ShortcutSection = {
  titleKey: string;
  rows: readonly ShortcutRow[];
};

const MOD = "Mod";

export const SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    titleKey: "whiteboardEditor:help.sections.tools",
    rows: [
      { labelKey: "whiteboardEditor:tools.select", keys: [["V"], ["1"]] },
      { labelKey: "whiteboardEditor:tools.hand", keys: [["H"], ["Space"]] },
      { labelKey: "whiteboardEditor:tools.rectangle", keys: [["R"], ["2"]] },
      { labelKey: "whiteboardEditor:tools.diamond", keys: [["D"], ["3"]] },
      { labelKey: "whiteboardEditor:tools.ellipse", keys: [["O"], ["4"]] },
      {
        labelKey: "whiteboardEditor:shapes.library",
        keys: [["Shift", "S"]],
      },
      { labelKey: "whiteboardEditor:tools.arrow", keys: [["A"], ["5"]] },
      { labelKey: "whiteboardEditor:tools.line", keys: [["L"], ["6"]] },
      { labelKey: "whiteboardEditor:tools.draw", keys: [["P"], ["7"]] },
      { labelKey: "whiteboardEditor:tools.text", keys: [["T"], ["8"]] },
      { labelKey: "whiteboardEditor:tools.sticky", keys: [["S"]] },
      { labelKey: "whiteboardEditor:tools.image", keys: [["9"]] },
      { labelKey: "whiteboardEditor:tools.eraser", keys: [["E"], ["0"]] },
      { labelKey: "whiteboardEditor:tools.frame", keys: [["F"]] },
      { labelKey: "whiteboardEditor:tools.laser", keys: [["K"]] },
      { labelKey: "whiteboardEditor:tools.lock", keys: [["Q"]] },
    ],
  },
  {
    titleKey: "whiteboardEditor:help.sections.view",
    rows: [
      { labelKey: "whiteboardEditor:zoom.in", keys: [[MOD, "+"]] },
      { labelKey: "whiteboardEditor:zoom.out", keys: [[MOD, "-"]] },
      { labelKey: "whiteboardEditor:zoom.reset", keys: [[MOD, "0"]] },
      { labelKey: "whiteboardEditor:zoom.fit", keys: [["Shift", "1"]] },
      { labelKey: "whiteboardEditor:zoom.selection", keys: [["Shift", "2"]] },
      {
        labelKey: "whiteboardEditor:help.pan",
        keys: [["Space", "drag"], ["wheel"]],
      },
      { labelKey: "whiteboardEditor:help.zoomWheel", keys: [[MOD, "wheel"]] },
      { labelKey: "whiteboardEditor:commands.toggleGrid", keys: [[MOD, "'"]] },
      {
        labelKey: "whiteboardEditor:commands.toggleSnap",
        keys: [["Alt", "S"]],
      },
      {
        labelKey: "whiteboardEditor:commands.toggleMinimap",
        keys: [["Alt", "M"]],
      },
      { labelKey: "whiteboardEditor:commands.search", keys: [[MOD, "F"]] },
      { labelKey: "whiteboardEditor:commands.help", keys: [["?"]] },
    ],
  },
  {
    titleKey: "whiteboardEditor:help.sections.edit",
    rows: [
      { labelKey: "whiteboardEditor:commands.undo", keys: [[MOD, "Z"]] },
      {
        labelKey: "whiteboardEditor:commands.redo",
        keys: [
          [MOD, "Shift", "Z"],
          [MOD, "Y"],
        ],
      },
      { labelKey: "whiteboardEditor:commands.copy", keys: [[MOD, "C"]] },
      { labelKey: "whiteboardEditor:commands.cut", keys: [[MOD, "X"]] },
      { labelKey: "whiteboardEditor:commands.paste", keys: [[MOD, "V"]] },
      { labelKey: "whiteboardEditor:commands.duplicate", keys: [[MOD, "D"]] },
      { labelKey: "whiteboardEditor:commands.delete", keys: [["Delete"]] },
      { labelKey: "whiteboardEditor:commands.selectAll", keys: [[MOD, "A"]] },
      {
        labelKey: "whiteboardEditor:commands.copyStyle",
        keys: [[MOD, "Alt", "C"]],
      },
      {
        labelKey: "whiteboardEditor:commands.pasteStyle",
        keys: [[MOD, "Alt", "V"]],
      },
      { labelKey: "whiteboardEditor:commands.editText", keys: [["Enter"]] },
      {
        labelKey: "whiteboardEditor:help.commitText",
        keys: [["Esc"], [MOD, "Enter"]],
      },
      {
        labelKey: "whiteboardEditor:crop.start",
        keys: [["Enter"], ["double-click"]],
      },
      {
        labelKey: "whiteboardEditor:help.finishCrop",
        keys: [["Enter"], ["Esc"]],
      },
    ],
  },
  {
    titleKey: "whiteboardEditor:help.sections.arrange",
    rows: [
      { labelKey: "whiteboardEditor:commands.group", keys: [[MOD, "G"]] },
      {
        labelKey: "whiteboardEditor:commands.ungroup",
        keys: [[MOD, "Shift", "G"]],
      },
      {
        labelKey: "whiteboardEditor:commands.bringForward",
        keys: [[MOD, "]"]],
      },
      {
        labelKey: "whiteboardEditor:commands.sendBackward",
        keys: [[MOD, "["]],
      },
      {
        labelKey: "whiteboardEditor:commands.bringToFront",
        keys: [[MOD, "Shift", "]"]],
      },
      {
        labelKey: "whiteboardEditor:commands.sendToBack",
        keys: [[MOD, "Shift", "["]],
      },
      {
        labelKey: "whiteboardEditor:commands.flipHorizontal",
        keys: [["Shift", "H"]],
      },
      {
        labelKey: "whiteboardEditor:commands.flipVertical",
        keys: [["Shift", "V"]],
      },
      {
        labelKey: "whiteboardEditor:commands.toggleElementLock",
        keys: [[MOD, "Shift", "L"]],
      },
      {
        labelKey: "whiteboardEditor:help.nudge",
        keys: [["←↑→↓"], ["Shift", "←↑→↓"]],
      },
      { labelKey: "whiteboardEditor:help.flowchart", keys: [[MOD, "←↑→↓"]] },
      {
        labelKey: "whiteboardEditor:help.cycle",
        keys: [
          ["Alt", "←"],
          ["Alt", "→"],
        ],
      },
      {
        labelKey: "whiteboardEditor:commands.alignLeft",
        keys: [[MOD, "Shift", "←"]],
      },
      {
        labelKey: "whiteboardEditor:commands.alignRight",
        keys: [[MOD, "Shift", "→"]],
      },
      {
        labelKey: "whiteboardEditor:commands.alignTop",
        keys: [[MOD, "Shift", "↑"]],
      },
      {
        labelKey: "whiteboardEditor:commands.alignBottom",
        keys: [[MOD, "Shift", "↓"]],
      },
    ],
  },
  {
    titleKey: "whiteboardEditor:help.sections.pointer",
    rows: [
      {
        labelKey: "whiteboardEditor:help.keepAspect",
        keys: [["Shift", "drag"]],
      },
      { labelKey: "whiteboardEditor:help.fromCentre", keys: [["Alt", "drag"]] },
      {
        labelKey: "whiteboardEditor:help.duplicateDrag",
        keys: [["Alt", "drag"]],
      },
      {
        labelKey: "whiteboardEditor:help.addToSelection",
        keys: [["Shift", "click"]],
      },
      {
        labelKey: "whiteboardEditor:help.enterGroup",
        keys: [["double-click"]],
      },
      { labelKey: "whiteboardEditor:help.noSnap", keys: [[MOD, "drag"]] },
    ],
  },
];

/** The label to show for the platform modifier. */
export function modifierLabel(mac = isMacPlatform()): string {
  return mac ? "⌘" : "Ctrl";
}
