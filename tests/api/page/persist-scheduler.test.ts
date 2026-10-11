import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PersistResult,
  PersistScheduler,
} from "../../../apps/api/src/page/collab/persist-scheduler";

function scheduler(results: PersistResult[] = []) {
  const persist = vi.fn(
    async (): Promise<PersistResult> => results.shift() ?? "saved",
  );
  const onSaveError = vi.fn();
  return {
    persist,
    onSaveError,
    scheduler: new PersistScheduler({ persist, onSaveError }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PersistScheduler", () => {
  it("persists 2 s after the last change", async () => {
    const { persist, scheduler: s } = scheduler();
    s.changed();
    await vi.advanceTimersByTimeAsync(1500);
    s.changed();
    await vi.advanceTimersByTimeAsync(1500);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("persists at most 10 s after the first unsaved change", async () => {
    const { persist, scheduler: s } = scheduler();
    for (let elapsed = 0; elapsed < 10_000; elapsed += 1000) {
      s.changed();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("runs one persist at a time and debounces changes made during it", async () => {
    let finish: (result: PersistResult) => void = () => {};
    const persist = vi.fn(
      () =>
        new Promise<PersistResult>((resolve) => {
          finish = resolve;
        }),
    );
    const s = new PersistScheduler({ persist, onSaveError: vi.fn() });
    const first = s.now();
    s.changed();
    void s.now();
    expect(persist).toHaveBeenCalledTimes(1);
    finish("saved");
    await vi.advanceTimersByTimeAsync(0);
    // The explicit flush reruns right away.
    expect(persist).toHaveBeenCalledTimes(2);
    finish("saved");
    await first;
    // The change during the run is persisted after the debounce.
    await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(3);
    finish("saved");
  });

  it("retries after 5 s, 15 s, then every 60 s, with save-error after the second failure", async () => {
    const {
      persist,
      onSaveError,
      scheduler: s,
    } = scheduler(["failed", "failed", "failed", "failed", "saved"]);
    await s.now();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(onSaveError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4999);
    expect(persist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(onSaveError).toHaveBeenCalledTimes(1);

    // A change during the backoff waits for the retry.
    s.changed();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(persist).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(persist).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(persist).toHaveBeenCalledTimes(5);
    expect(s.failureCount).toBe(0);
    expect(onSaveError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledTimes(5);
  });

  it("flushes immediately on demand and stops for good", async () => {
    const { persist, scheduler: s } = scheduler();
    s.changed();
    await s.now();
    expect(persist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(persist).toHaveBeenCalledTimes(1);

    s.changed();
    s.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    await s.now();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
