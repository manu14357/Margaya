import { shortcuts } from "@/constants/shortcuts";
import { isTypingTarget, shortcutKey } from "@/lib/shortcut-key";

export { isTypingTarget };

/** What a key press on an open task asks for. */
export type TaskShortcutAction =
  | "status"
  | "priority"
  | "assignees"
  | "labels"
  | "dueDate"
  | "assignSelf"
  | "copyKey"
  | "copyLink"
  | "copyBranch"
  | "delete";

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

const keys = shortcuts.taskDetails;

const SINGLE_KEYS: Record<string, TaskShortcutAction> = {
  [keys.status]: "status",
  [keys.priority]: "priority",
  [keys.assignee]: "assignees",
  [keys.labels]: "labels",
  [keys.dueDate]: "dueDate",
  [keys.assignSelf]: "assignSelf",
};

/**
 * The action a key press maps to, or null. Single keys take no modifier;
 * the chords take Ctrl or ⌘. `code` covers layouts where Shift turns `,`
 * into another character.
 */
export function resolveTaskShortcut(event: KeyLike): TaskShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  if (event.altKey) return null;

  if (!mod) {
    if (event.shiftKey || event.key.length !== 1) return null;
    return SINGLE_KEYS[shortcutKey(event)] ?? null;
  }

  if (event.ctrlKey && event.metaKey) return null;
  const isPeriod = event.code === "Period" || event.key === keys.copyKey;
  const isComma = event.code === "Comma" || event.key === keys.copyLink;
  if (!event.shiftKey && isPeriod) return "copyKey";
  if (event.shiftKey && isComma) return "copyLink";
  const isBranch =
    event.code === "KeyG" ||
    event.key.toLowerCase() === keys.copyBranch.toLowerCase();
  if (event.shiftKey && isBranch) return "copyBranch";
  if (
    !event.shiftKey &&
    (event.key === keys.delete || event.key === "Delete")
  ) {
    return "delete";
  }
  return null;
}

const OVERLAYS = [
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[data-slot='popover-popup']",
  "[data-slot='menu-popup']",
  "[data-slot='dialog-popup']",
  "[data-slot='alert-dialog-popup']",
  "[data-slot='command-dialog-popup']",
  "[data-slot='combobox-popup']",
  "[data-slot='autocomplete-popup']",
  "[data-slot='select-popup']",
  "[data-slot='sheet-popup']",
].join(", ");

/** The attribute that marks the open task's own surface (sheet or page). */
export const TASK_SURFACE_ATTRIBUTE = "data-task-surface";

/**
 * True while a popover, menu or dialog other than the task's own sheet is
 * open: its keys are its own.
 */
export function hasOpenOverlay(root: ParentNode = document): boolean {
  for (const element of root.querySelectorAll(OVERLAYS)) {
    if (
      element.hasAttribute(TASK_SURFACE_ATTRIBUTE) ||
      element.querySelector(`[${TASK_SURFACE_ATTRIBUTE}]`)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Whether the open task may take this key press: never while typing, while
 * another overlay is open, or halfway through a `g …` style sequence.
 */
export function shouldHandleTaskShortcut(
  event: KeyLike & Pick<KeyboardEvent, "target" | "defaultPrevented">,
  { activePrefix }: { activePrefix: string | null },
): boolean {
  if (event.defaultPrevented || activePrefix) return false;
  if (isTypingTarget(event.target)) return false;
  return !hasOpenOverlay();
}
