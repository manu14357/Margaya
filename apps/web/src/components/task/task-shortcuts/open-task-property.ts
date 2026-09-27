import { TASK_SURFACE_ATTRIBUTE } from "./task-shortcut-keys";

/** Property rows of the open task's grid (`data-property` in the sidebar). */
export type TaskPickerProperty =
  | "status"
  | "priority"
  | "assignees"
  | "labels"
  | "dueDate"
  | "estimate"
  | "cycle"
  | "module";

/** The attribute on the wrapper of the open task's delete button. */
export const TASK_DELETE_ATTRIBUTE = "data-task-delete";

function surfaces(): Element[] {
  return Array.from(document.querySelectorAll(`[${TASK_SURFACE_ATTRIBUTE}]`));
}

/**
 * The picker trigger of a property row of the open task. The row's last
 * trigger is its picker: label and module rows put their chips first.
 */
function pickerTrigger(property: TaskPickerProperty): HTMLElement | null {
  for (const surface of surfaces().reverse()) {
    const row = surface.querySelector(
      `[data-property="${CSS.escape(property)}"]`,
    );
    const triggers = row?.querySelectorAll<HTMLElement>(
      "[data-slot='popover-trigger']",
    );
    const trigger = triggers?.[triggers.length - 1];
    if (trigger) return trigger;
  }
  return null;
}

/** Whether the open task shows a picker for this property right now. */
export function hasTaskPicker(property: TaskPickerProperty): boolean {
  return pickerTrigger(property) !== null;
}

/**
 * Opens the same picker the property grid opens on click, so the picker,
 * its mutation and its cache updates stay the grid's own.
 */
export function openTaskPicker(property: TaskPickerProperty): boolean {
  const trigger = pickerTrigger(property);
  if (!trigger) return false;
  trigger.scrollIntoView?.({ block: "nearest" });
  trigger.click();
  return true;
}

function deleteTrigger(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${TASK_DELETE_ATTRIBUTE}] button`,
  );
}

export function hasTaskDelete(): boolean {
  return deleteTrigger() !== null;
}

/** Opens the open task's delete confirmation, exactly as its button does. */
export function openTaskDelete(): boolean {
  const trigger = deleteTrigger();
  if (!trigger) return false;
  trigger.click();
  return true;
}
