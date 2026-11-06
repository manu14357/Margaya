import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import { adjacentCard, useCardKeyboard } from "./use-card-keyboard";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const COLUMNS: Record<string, string[]> = {
  todo: ["a", "b", "c"],
  empty: [],
  doing: ["d"],
};

function Board({ dragging = false }: { dragging?: boolean }) {
  useCardKeyboard(useBulkSelectionStore, dragging);
  return (
    <>
      {Object.entries(COLUMNS).map(([column, cards]) => (
        <section key={column} data-board-column>
          {cards.map((id) => (
            // biome-ignore lint/a11y/useSemanticElements: mirrors the sortable card's attributes
            <div key={id} role="button" tabIndex={0} data-board-card={id}>
              {id}
            </div>
          ))}
        </section>
      ))}
      <input aria-label="field" />
      <button type="button">action</button>
    </>
  );
}

const card = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-board-card="${id}"]`,
  ) as HTMLElement;

const press = (target: Element, key: string) =>
  fireEvent.keyDown(target, { key, code: key });

beforeEach(() => {
  navigate.mockClear();
  window.history.replaceState(null, "", "/");
  useBulkSelectionStore.getState().clearFocus();
  useBulkSelectionStore.getState().clearSelection();
  useBulkSelectionStore
    .getState()
    .setAvailableTasks(Object.values(COLUMNS).flat());
});

afterEach(cleanup);

describe("adjacentCard", () => {
  beforeEach(() => {
    render(<Board />);
  });

  it("moves up and down inside a column and stops at its ends", () => {
    expect(adjacentCard(card("a"), "ArrowDown")).toBe(card("b"));
    expect(adjacentCard(card("b"), "ArrowUp")).toBe(card("a"));
    expect(adjacentCard(card("a"), "ArrowUp")).toBeNull();
    expect(adjacentCard(card("c"), "ArrowDown")).toBeNull();
  });

  it("moves across columns, skipping empty ones and clamping the row", () => {
    expect(adjacentCard(card("c"), "ArrowRight")).toBe(card("d"));
    expect(adjacentCard(card("d"), "ArrowLeft")).toBe(card("a"));
    expect(adjacentCard(card("a"), "ArrowLeft")).toBeNull();
    expect(adjacentCard(card("d"), "ArrowRight")).toBeNull();
  });
});

describe("useCardKeyboard", () => {
  it("moves focus with j and k without opening the task", () => {
    render(<Board />);

    press(document.body, "j");
    expect(document.activeElement).toBe(card("a"));
    press(card("a"), "j");
    expect(document.activeElement).toBe(card("b"));
    press(card("b"), "k");
    expect(document.activeElement).toBe(card("a"));

    expect(useBulkSelectionStore.getState().focusedTaskId).toBe("a");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("moves the sheet along when one is already open", () => {
    window.history.replaceState(null, "", "/?taskId=a");
    render(<Board />);

    press(document.body, "j");

    expect(navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "a" },
    });
  });

  it("moves focus with the arrow keys from a focused card", () => {
    render(<Board />);
    card("a").focus();

    press(card("a"), "ArrowDown");
    expect(document.activeElement).toBe(card("b"));
    press(card("b"), "ArrowRight");
    expect(document.activeElement).toBe(card("d"));
    expect(useBulkSelectionStore.getState().focusedTaskId).toBe("d");
  });

  it("selects the focused card with x", () => {
    render(<Board />);
    card("b").focus();

    press(card("b"), "x");
    expect(useBulkSelectionStore.getState().isSelected("b")).toBe(true);
    press(card("b"), "x");
    expect(useBulkSelectionStore.getState().isSelected("b")).toBe(false);
  });

  it("leaves keys on a field or button to them", () => {
    const { getByLabelText, getByText } = render(<Board />);

    press(getByLabelText("field"), "j");
    press(getByText("action"), "j");
    press(getByText("action"), "x");

    expect(useBulkSelectionStore.getState().focusedTaskId).toBeNull();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });

  it("opens the ring's task on Enter only when focus is on no control", () => {
    const { getByText } = render(<Board />);
    act(() => useBulkSelectionStore.getState().setFocusedTask("b"));

    press(getByText("action"), "Enter");
    expect(navigate).not.toHaveBeenCalled();

    press(document.body, "Enter");
    expect(navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "b" },
    });
  });

  it("stands aside during a keyboard drag", () => {
    render(<Board dragging />);
    card("a").focus();

    press(card("a"), "ArrowDown");
    press(card("a"), "j");

    expect(document.activeElement).toBe(card("a"));
    expect(useBulkSelectionStore.getState().focusedTaskId).toBeNull();
  });
});
