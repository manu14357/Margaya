import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardTaskEdit,
  saveTaskEdit,
  taskEditKey,
  unsavedTaskEdit,
} from "./task-edit-saves";

const KEY = taskEditKey("title", "task-1");

function handlers(send: (value: string) => Promise<unknown>) {
  return {
    send: vi.fn(send),
    notifyFailed: vi.fn((_retry: () => void) => "failure-toast"),
    dismissFailed: vi.fn(),
  };
}

function closingTheTabIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  discardTaskEdit(KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("task edit saves", () => {
  it("guards the tab from the edit until the save has finished", async () => {
    let finish: (value?: unknown) => void = () => {};
    const edit = handlers(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    expect(closingTheTabIsBlocked()).toBe(false);
    saveTaskEdit(KEY, "typed", edit, 100);
    expect(closingTheTabIsBlocked()).toBe(true);
    expect(unsavedTaskEdit(KEY)).toBe("typed");

    await vi.advanceTimersByTimeAsync(100);
    expect(edit.send).toHaveBeenCalledWith("typed");
    expect(closingTheTabIsBlocked()).toBe(true);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(closingTheTabIsBlocked()).toBe(false);
    expect(unsavedTaskEdit(KEY)).toBeUndefined();
  });

  it("keeps a failed edit, says so, and saves it on retry", async () => {
    const edit = handlers(() => Promise.reject(new Error("offline")));

    saveTaskEdit(KEY, "typed", edit);
    await vi.advanceTimersByTimeAsync(0);

    expect(edit.notifyFailed).toHaveBeenCalledTimes(1);
    expect(unsavedTaskEdit(KEY)).toBe("typed");
    expect(closingTheTabIsBlocked()).toBe(true);

    edit.send.mockResolvedValueOnce({});
    edit.notifyFailed.mock.calls[0]?.[0]();
    expect(edit.dismissFailed).toHaveBeenCalledWith("failure-toast");
    await vi.advanceTimersByTimeAsync(0);

    expect(edit.send).toHaveBeenCalledTimes(2);
    expect(edit.send).toHaveBeenLastCalledWith("typed");
    expect(unsavedTaskEdit(KEY)).toBeUndefined();
    expect(closingTheTabIsBlocked()).toBe(false);
  });

  it("lets a newer edit replace a failure and ignores the older answer", async () => {
    let failFirst: (error: Error) => void = () => {};
    const first = handlers(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    const second = handlers(() => Promise.resolve({}));

    saveTaskEdit(KEY, "first", first);
    saveTaskEdit(KEY, "second", second, 100);

    failFirst(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.notifyFailed).not.toHaveBeenCalled();
    expect(unsavedTaskEdit(KEY)).toBe("second");

    await vi.advanceTimersByTimeAsync(100);
    expect(second.send).toHaveBeenCalledWith("second");
    expect(unsavedTaskEdit(KEY)).toBeUndefined();
  });

  it("clears the failure shown for an edit the user took back", async () => {
    const edit = handlers(() => Promise.reject(new Error("offline")));

    saveTaskEdit(KEY, "typed", edit);
    await vi.advanceTimersByTimeAsync(0);
    discardTaskEdit(KEY);

    expect(edit.dismissFailed).toHaveBeenCalledWith("failure-toast");
    expect(unsavedTaskEdit(KEY)).toBeUndefined();
    expect(closingTheTabIsBlocked()).toBe(false);
  });

  it("keeps edits of different tasks apart", async () => {
    const otherKey = taskEditKey("title", "task-2");
    const edit = handlers(() => Promise.resolve({}));
    const other = handlers(() => Promise.resolve({}));

    saveTaskEdit(KEY, "one", edit, 100);
    saveTaskEdit(otherKey, "two", other, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(edit.send).toHaveBeenCalledWith("one");
    expect(other.send).toHaveBeenCalledWith("two");
  });
});
