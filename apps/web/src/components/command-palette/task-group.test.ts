import { describe, expect, it, vi } from "vitest";
import { openTaskGroupItems } from "./task-group";

describe("openTaskGroupItems", () => {
  it("leaves out commands that cannot run now", () => {
    const items = openTaskGroupItems([
      {
        id: "status",
        label: "Change status",
        run: vi.fn(),
        picker: true,
        isAvailable: () => true,
      },
      {
        id: "cycle",
        label: "Change cycle",
        run: vi.fn(),
        picker: true,
        isAvailable: () => false,
      },
      {
        id: "copyKey",
        label: "Copy task key",
        keys: ["Ctrl", "."],
        run: vi.fn(),
      },
    ]);
    expect(items.map((item) => item.value)).toEqual([
      "task-command:status",
      "task-command:copyKey",
    ]);
    expect(items[1]?.shortcut).toBe("Ctrl .");
  });

  it("defers pickers until the palette has closed, and runs the rest at once", () => {
    const openStatus = vi.fn();
    const copyKey = vi.fn();
    const [status, copy] = openTaskGroupItems([
      { id: "status", label: "Change status", run: openStatus, picker: true },
      { id: "copyKey", label: "Copy task key", run: copyKey },
    ]);

    expect(status?.afterClose).toBe(true);
    expect(copy?.afterClose).toBe(false);
    status?.onRun();
    copy?.onRun();
    expect(openStatus).toHaveBeenCalledTimes(1);
    expect(copyKey).toHaveBeenCalledTimes(1);
  });
});
