import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discardTaskEdit, taskEditKey } from "./task-edit-saves";
import TaskTitle from "./task-title";

const m = vi.hoisted(() => ({
  task: {
    id: "task-1",
    projectId: "p-1",
    title: "A long task title that wraps across several lines",
  },
  canEdit: true,
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: m.toastError, dismiss: m.toastDismiss },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => ({ data: m.task }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-title", () => ({
  useUpdateTaskTitle: () => ({ mutateAsync: m.mutateAsync }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => m.canEdit }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  m.canEdit = true;
  m.mutateAsync.mockReset().mockResolvedValue(undefined);
  m.toastError.mockReset().mockReturnValue("failure-toast");
  m.toastDismiss.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  discardTaskEdit(taskEditKey("title", "task-1"));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function titleField() {
  return screen.getByPlaceholderText(
    "tasks:detail.titlePlaceholder",
  ) as HTMLTextAreaElement;
}

describe("TaskTitle", () => {
  it("wraps long titles in a one-line textbox", () => {
    render(<TaskTitle taskId="task-1" />);
    const field = titleField();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("aria-multiline", "false");
    expect(field).toHaveValue(m.task.title);
    expect(field).not.toHaveAttribute("readonly");
  });

  it("saves on Enter instead of adding a newline", () => {
    render(<TaskTitle taskId="task-1" />);
    const field = titleField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Renamed" } });
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false);
    expect(m.mutateAsync).toHaveBeenCalledTimes(1);
    expect(m.mutateAsync).toHaveBeenCalledWith({
      ...m.task,
      title: "Renamed",
    });
    // The debounced save was replaced, not repeated.
    act(() => vi.advanceTimersByTime(1000));
    expect(m.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("turns pasted line breaks into spaces", () => {
    render(<TaskTitle taskId="task-1" />);
    const field = titleField();
    fireEvent.change(field, { target: { value: "One\ntwo\r\nthree" } });
    expect(field).toHaveValue("One two three");
  });

  it("cancels the edit on Escape without saving", () => {
    const onParentKeyDown = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for the panel's Escape handler
      <div onKeyDown={onParentKeyDown}>
        <TaskTitle taskId="task-1" />
      </div>,
    );
    const field = titleField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Half-typed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue(m.task.title);
    act(() => vi.advanceTimersByTime(1000));
    expect(m.mutateAsync).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("shows a failed save, keeps the text, and saves it on retry", async () => {
    m.mutateAsync.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<TaskTitle taskId="task-1" />);
    const field = titleField();
    fireEvent.change(field, { target: { value: "Renamed" } });
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(m.mutateAsync).toHaveBeenCalledTimes(1);
    expect(m.toastError).toHaveBeenCalledTimes(1);
    const [message, options] = m.toastError.mock.calls[0] ?? [];
    expect(message).toBe("tasks:detail.saveError.title");
    expect(options.persistent).toBe(true);
    expect(options.action.label).toBe("tasks:detail.saveError.retry");
    expect(field).toHaveValue("Renamed");

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // Closing the panel and coming back still shows the unsaved text.
    unmount();
    render(<TaskTitle taskId="task-1" />);
    expect(titleField()).toHaveValue("Renamed");

    await act(async () => {
      options.action.onClick();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(m.mutateAsync).toHaveBeenCalledTimes(2);
    expect(m.mutateAsync).toHaveBeenLastCalledWith({
      ...m.task,
      title: "Renamed",
    });

    const afterRetry = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterRetry);
    expect(afterRetry.defaultPrevented).toBe(false);
  });

  it("warns before the tab closes while a save is waiting", async () => {
    render(<TaskTitle taskId="task-1" />);
    fireEvent.change(titleField(), { target: { value: "Renamed" } });

    const waiting = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(waiting);
    expect(waiting.defaultPrevented).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(800));
    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it("is read-only without permission to edit tasks", () => {
    m.canEdit = false;
    render(<TaskTitle taskId="task-1" />);
    expect(titleField()).toHaveAttribute("readonly");
  });
});
