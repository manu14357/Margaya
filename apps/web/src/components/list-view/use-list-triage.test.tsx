import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import { useListTriage } from "./use-list-triage";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  activePrefix: null as string | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useKeyboardShortcuts: () => ({ activePrefix: mocks.activePrefix }),
}));

const clicks: string[] = [];

function Harness() {
  useListTriage();
  return (
    <div>
      {["a", "b", "c"].map((id) => (
        <div key={id} data-task-row={id}>
          {(["status", "priority", "assignee"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-triage={kind}
              onClick={() => clicks.push(`${id}:${kind}`)}
            >
              {kind}
            </button>
          ))}
        </div>
      ))}
      <input aria-label="other" />
    </div>
  );
}

function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const focused = () => useBulkSelectionStore.getState().focusedTaskId;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useBulkSelectionStore.getState().setAvailableTasks(["a", "b", "c"]);
  useBulkSelectionStore.getState().clearFocus();
  useBulkSelectionStore.getState().clearSelection();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  clicks.length = 0;
  mocks.navigate.mockReset();
  mocks.activePrefix = null;
});

describe("useListTriage", () => {
  it("moves the focus with j and k without opening the sheet", () => {
    render(<Harness />);
    press("j");
    expect(focused()).toBe("a");
    press("j");
    expect(focused()).toBe("b");
    press("k");
    expect(focused()).toBe("a");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("moves the open sheet along with the focus", () => {
    window.history.replaceState(null, "", "/?taskId=a");
    render(<Harness />);
    press("j");
    press("j");
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: ".",
      search: { taskId: "b" },
    });
  });

  it("selects the focused task with x and opens it with Enter", () => {
    render(<Harness />);
    press("j");
    press("x");
    expect(useBulkSelectionStore.getState().selectedTaskIds.has("a")).toBe(
      true,
    );
    press("x");
    expect(useBulkSelectionStore.getState().selectedTaskIds.has("a")).toBe(
      false,
    );
    press("Enter");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: "a" },
    });
  });

  it("opens the focused row's status, priority and assignee popovers", () => {
    render(<Harness />);
    press("j");
    press("j");
    const status = press("s");
    press("!");
    press("a");
    expect(clicks).toEqual(["b:status", "b:priority", "b:assignee"]);
    expect(status.defaultPrevented).toBe(true);
  });

  it("does nothing without a focused row", () => {
    render(<Harness />);
    const event = press("s");
    expect(clicks).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("stands aside while typing, during a key sequence or with modifiers", () => {
    const { getByLabelText } = render(<Harness />);
    press("j", getByLabelText("other"));
    expect(focused()).toBeNull();

    mocks.activePrefix = "g";
    cleanup();
    render(<Harness />);
    press("j");
    expect(focused()).toBeNull();

    mocks.activePrefix = null;
    cleanup();
    render(<Harness />);
    const event = new KeyboardEvent("keydown", {
      key: "j",
      ctrlKey: true,
      bubbles: true,
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(focused()).toBeNull();
  });

  it("keeps working from a row's own trigger after its popover closes", () => {
    const { container } = render(<Harness />);
    press("j");
    const trigger = container.querySelector<HTMLElement>(
      '[data-task-row="a"] [data-triage="status"]',
    );
    press("j", trigger as HTMLElement);
    expect(focused()).toBe("b");
  });
});
