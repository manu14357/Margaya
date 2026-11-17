import type { Settings } from "./ipc";

type Platform = Settings["platform"];

/** What a key press means to the shortcut recorder. */
export type RecordedKey =
  | { kind: "incomplete" }
  | { kind: "cancel" }
  | { kind: "done"; accelerator: string };

type KeyPress = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
  "",
]);

/**
 * Turns a keydown into the core's combination format ("Control+Alt+KeyK").
 * The physical key code is used, so the combination doesn't depend on the
 * keyboard layout. The core decides whether it is allowed.
 */
export function recordKey(event: KeyPress): RecordedKey {
  const modified =
    event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
  if (event.code === "Escape" && !modified) return { kind: "cancel" };
  if (MODIFIER_CODES.has(event.code)) return { kind: "incomplete" };
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.code);
  return { kind: "done", accelerator: parts.join("+") };
}

const MAC_MODIFIERS: Record<string, string> = {
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  command: "⌘",
  cmd: "⌘",
  super: "⌘",
  control: "⌃",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};

const KEY_NAMES: Record<string, string> = {
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backquote: "`",
  minus: "-",
  equal: "=",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  bracketleft: "[",
  bracketright: "]",
  semicolon: ";",
  quote: "'",
  escape: "Esc",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  pageup: "Page Up",
  pagedown: "Page Down",
};

function keyName(token: string): string {
  const lower = token.toLowerCase();
  if (/^key[a-z]$/.test(lower)) return token.slice(3).toUpperCase();
  if (/^digit[0-9]$/.test(lower)) return token.slice(5);
  if (/^[a-z0-9]$/.test(lower)) return token.toUpperCase();
  return KEY_NAMES[lower] ?? token;
}

/** A combination as people read it: "Ctrl+Shift+K", or "⌘⇧K" on a Mac. */
export function formatAccelerator(
  accelerator: string,
  platform: Platform,
): string {
  const tokens = accelerator.split("+").filter(Boolean);
  const key = keyName(tokens.at(-1) ?? "");
  const modifiers = tokens.slice(0, -1).map((token) => token.toLowerCase());
  if (platform === "macos") {
    return modifiers.map((m) => MAC_MODIFIERS[m] ?? m).join("") + key;
  }
  const names = modifiers.map((m) => {
    switch (m) {
      case "commandorcontrol":
      case "cmdorctrl":
      case "control":
      case "ctrl":
        return "Ctrl";
      case "alt":
      case "option":
        return "Alt";
      case "shift":
        return "Shift";
      case "super":
      case "command":
      case "cmd":
        return platform === "windows" ? "Win" : "Super";
      default:
        return m;
    }
  });
  return [...names, key].join("+");
}
