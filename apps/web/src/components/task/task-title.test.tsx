import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskTitle from "./task-title";

const m = vi.hoisted(() => ({
  task: {
    id: "task-1",
    projectId: "p-1",
    title: "A long task title that wraps across several lines",
  },
  canEdit: true,
  mutateAsync: vi.fn(),
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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it("is read-only without permission to edit tasks", () => {
    m.canEdit = false;
    render(<TaskTitle taskId="task-1" />);
    expect(titleField()).toHaveAttribute("readonly");
  });
});
