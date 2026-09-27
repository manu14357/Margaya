import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useOpenTaskStore, { type TaskCommand } from "./open-task-store";
import TaskSurfaceShortcuts, {
  taskCommandForKey,
} from "./task-surface-shortcuts";

const m = vi.hoisted(() => ({
  commands: [] as TaskCommand[],
  prefix: null as string | null,
}));

vi.mock("./use-task-commands", () => ({
  useTaskCommands: () => ({ commands: m.commands, title: "WEB-12 Fix login" }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useActiveShortcutPrefix: () => m.prefix,
  getModifierKeyText: () => "Ctrl",
}));

function command(id: TaskCommand["id"], extra: Partial<TaskCommand> = {}) {
  return { id, label: id, run: vi.fn(), ...extra } as TaskCommand & {
    run: ReturnType<typeof vi.fn>;
  };
}

function keydown(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  m.commands = [];
  m.prefix = null;
  useOpenTaskStore.setState({ taskId: null, title: null, commands: [] });
});

describe("taskCommandForKey", () => {
  const event = (key: string, target: EventTarget = document.body) =>
    ({
      key,
      code: "",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target,
    }) as unknown as KeyboardEvent;

  it("finds the permitted command for the key", () => {
    const status = command("status");
    expect(taskCommandForKey(event("s"), [status], null)).toBe(status);
  });

  it("does nothing without the permission (no command)", () => {
    // useTaskCommands leaves out what the role may not do.
    expect(taskCommandForKey(event("p"), [command("status")], null)).toBeNull();
  });

  it("does nothing when the picker is not on screen", () => {
    const status = command("status", { isAvailable: () => false });
    expect(taskCommandForKey(event("s"), [status], null)).toBeNull();
  });

  it("does nothing while typing", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(
      taskCommandForKey(event("s", input), [command("status")], null),
    ).toBeNull();
  });
});

describe("TaskSurfaceShortcuts", () => {
  it("runs the command for a key and keeps it from the app-wide keys", () => {
    const priority = command("priority");
    m.commands = [priority];
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    render(
      <TaskSurfaceShortcuts taskId="t1" projectId="p1" workspaceId="w1" />,
    );

    const pressed = keydown({ key: "p" });

    expect(priority.run).toHaveBeenCalledTimes(1);
    expect(pressed.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
  });

  it("lets keys through mid-sequence and while typing", () => {
    const labels = command("labels");
    m.commands = [labels];
    m.prefix = "g";
    const { rerender } = render(
      <TaskSurfaceShortcuts taskId="t1" projectId="p1" workspaceId="w1" />,
    );
    keydown({ key: "l" });
    expect(labels.run).not.toHaveBeenCalled();

    m.prefix = null;
    rerender(
      <TaskSurfaceShortcuts taskId="t1" projectId="p1" workspaceId="w1" />,
    );
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    keydown({ key: "l" }, editor);
    expect(labels.run).not.toHaveBeenCalled();
  });

  it("runs the copy chords", () => {
    const copyKey = command("copyKey");
    const copyLink = command("copyLink");
    m.commands = [copyKey, copyLink];
    render(
      <TaskSurfaceShortcuts taskId="t1" projectId="p1" workspaceId="w1" />,
    );

    keydown({ key: ".", code: "Period", ctrlKey: true });
    keydown({ key: "<", code: "Comma", metaKey: true, shiftKey: true });

    expect(copyKey.run).toHaveBeenCalledTimes(1);
    expect(copyLink.run).toHaveBeenCalledTimes(1);
  });

  it("publishes its commands for the palette while open", () => {
    m.commands = [command("status")];
    const { unmount } = render(
      <TaskSurfaceShortcuts taskId="t1" projectId="p1" workspaceId="w1" />,
    );
    expect(useOpenTaskStore.getState().taskId).toBe("t1");
    expect(useOpenTaskStore.getState().commands).toHaveLength(1);

    unmount();
    expect(useOpenTaskStore.getState().taskId).toBeNull();
    expect(useOpenTaskStore.getState().commands).toHaveLength(0);
  });

  it("stays idle without an open task", () => {
    const status = command("status");
    m.commands = [status];
    render(
      <TaskSurfaceShortcuts
        taskId={undefined}
        projectId="p1"
        workspaceId="w1"
      />,
    );
    keydown({ key: "s" });
    expect(status.run).not.toHaveBeenCalled();
    expect(useOpenTaskStore.getState().taskId).toBeNull();
  });
});
