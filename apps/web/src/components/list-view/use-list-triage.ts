import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { shortcuts } from "@/constants/shortcuts";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import useBulkSelectionStore from "@/store/bulk-selection";
import type { TriageKind } from "./triage-triggers";

/** Focus inside these means the keys belong to something else. */
const OWNED_BY_OTHERS = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='true']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[data-slot='popover-popup']",
].join(", ");

function rowOf(taskId: string) {
  return document.querySelector<HTMLElement>(
    `[data-task-row="${CSS.escape(taskId)}"]`,
  );
}

/**
 * Keyboard triage in the list (DESIGN-SYSTEM §7.3): `j`/`k` move the focus
 * ring, `x` selects, `Enter` opens the task in the sheet, and `s`, `!` and
 * `a` open the focused row's status, priority and assignee popovers. While
 * the sheet is open, moving also moves the sheet along.
 *
 * Its own listener (not useRegisterShortcuts) so that it can stand aside
 * while a control, menu or dialog has focus, or a `g …` sequence is half
 * typed, instead of swallowing those keys.
 */
export function useListTriage() {
  const navigate = useNavigate();
  const { activePrefix } = useKeyboardShortcuts();

  useEffect(() => {
    const keys = shortcuts.triage;

    const openTrigger = (kind: TriageKind) => {
      const focused = useBulkSelectionStore.getState().focusedTaskId;
      if (!focused) return false;
      const trigger = rowOf(focused)?.querySelector<HTMLElement>(
        `[data-triage="${kind}"]`,
      );
      if (!trigger) return false;
      trigger.click();
      return true;
    };

    const move = (direction: 1 | -1) => {
      const store = useBulkSelectionStore.getState();
      if (direction === 1) store.focusNext();
      else store.focusPrevious();
      const focused = useBulkSelectionStore.getState().focusedTaskId;
      if (!focused) return;
      rowOf(focused)?.scrollIntoView({ block: "nearest" });
      const sheetOpen = new URLSearchParams(window.location.search).has(
        "taskId",
      );
      if (sheetOpen) navigate({ to: ".", search: { taskId: focused } });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || activePrefix) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const owner = target?.closest?.(OWNED_BY_OTHERS);
      // A row's own property trigger keeps triage going after its popover
      // closes and hands focus back to it.
      if (owner && !owner.matches("[data-triage]")) return;

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const focused = useBulkSelectionStore.getState().focusedTaskId;
      let handled = true;

      if (key === keys.next) move(1);
      else if (key === keys.previous) move(-1);
      else if (key === keys.select && focused) {
        useBulkSelectionStore.getState().toggleSelection(focused);
      } else if (key === "Enter" && focused) {
        navigate({ to: ".", search: { taskId: focused } });
      } else if (key === keys.status) handled = openTrigger("status");
      else if (key === keys.priority) handled = openTrigger("priority");
      else if (key === keys.assignee) handled = openTrigger("assignee");
      else handled = false;

      if (handled) event.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate, activePrefix]);
}
