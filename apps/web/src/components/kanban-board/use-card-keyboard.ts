import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { shortcuts } from "@/constants/shortcuts";
import { useActiveShortcutPrefix } from "@/hooks/use-keyboard-shortcuts";
import { KEYS_OWNED_BY_OTHERS, shortcutKey } from "@/lib/shortcut-key";

/** The part of a bulk selection store that keyboard movement needs. */
type FocusStore = {
  getState: () => {
    focusedTaskId: string | null;
    focusNext: () => void;
    focusPrevious: () => void;
    setFocusedTask: (taskId: string | null) => void;
    toggleSelection: (taskId: string) => void;
  };
};

const CARD = "[data-board-card]";
const COLUMN = "[data-board-column]";

function cardsIn(scope: ParentNode) {
  return Array.from(scope.querySelectorAll<HTMLElement>(CARD));
}

/**
 * The card an arrow key lands on. Up and down stay in the column (or the
 * whole list where there are no columns). Left and right skip empty columns
 * and keep the card's place in the column as far as the neighbour reaches.
 */
export function adjacentCard(card: HTMLElement, key: string) {
  const column = card.closest(COLUMN);
  const cards = cardsIn(column ?? document);
  const index = cards.indexOf(card);

  if (key === "ArrowDown") return cards[index + 1] ?? null;
  if (key === "ArrowUp") return cards[index - 1] ?? null;
  if (!column || (key !== "ArrowLeft" && key !== "ArrowRight")) return null;

  const columns = Array.from(document.querySelectorAll(COLUMN)).filter(
    (candidate) => candidate === column || cardsIn(candidate).length > 0,
  );
  const neighbour =
    columns[columns.indexOf(column) + (key === "ArrowRight" ? 1 : -1)];
  if (!neighbour) return null;
  const neighbours = cardsIn(neighbour);
  return neighbours[Math.min(index, neighbours.length - 1)] ?? null;
}

/**
 * Keyboard movement over cards: arrow keys move focus from a focused card,
 * `j`/`k` walk every card, `x` selects, and `Enter` opens the task when focus
 * is on no control. A card handles its own `Enter`. Moving never opens a task,
 * but moves the sheet along if one is already open.
 *
 * Its own listener (not useRegisterShortcuts) so that it can stand aside while
 * a control, menu or dialog has focus, or a `g …` sequence is half typed. It
 * also stands aside during a keyboard drag, where arrow keys move the card.
 */
export function useCardKeyboard(store: FocusStore, dragging: boolean) {
  const navigate = useNavigate();
  const activePrefix = useActiveShortcutPrefix();

  useEffect(() => {
    if (dragging) return;
    const keys = shortcuts.triage;

    const move = (direction: 1 | -1, from: string | undefined) => {
      const state = store.getState();
      if (from) state.setFocusedTask(from);
      if (direction === 1) state.focusNext();
      else state.focusPrevious();
      const focused = store.getState().focusedTaskId;
      if (!focused) return;
      document
        .querySelector<HTMLElement>(
          `${CARD}[data-board-card="${CSS.escape(focused)}"]`,
        )
        ?.focus();
      const sheetOpen = new URLSearchParams(window.location.search).has(
        "taskId",
      );
      if (sheetOpen) navigate({ to: ".", search: { taskId: focused } });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || activePrefix) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(KEYS_OWNED_BY_OTHERS)) return;

      const card = target?.closest?.<HTMLElement>(CARD) ?? null;
      const cardId = card?.dataset.boardCard;
      const key = shortcutKey(event);
      const focused = cardId ?? store.getState().focusedTaskId;
      let handled = true;

      if (key === keys.next) move(1, cardId);
      else if (key === keys.previous) move(-1, cardId);
      else if (key === keys.select && focused) {
        store.getState().toggleSelection(focused);
      } else if (key === "Enter" && focused && target === document.body) {
        navigate({ to: ".", search: { taskId: focused } });
      } else if (key.startsWith("Arrow") && card && target === card) {
        const next = adjacentCard(card, key);
        if (next?.dataset.boardCard) {
          store.getState().setFocusedTask(next.dataset.boardCard);
          next.focus();
        }
      } else handled = false;

      if (handled) event.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store, navigate, activePrefix, dragging]);
}
