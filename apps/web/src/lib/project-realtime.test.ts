import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBatchedRefresh,
  isProjectSocketLive,
  markProjectSocketLive,
  subscribeToProjectSockets,
} from "./project-realtime";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("project socket status", () => {
  it("stays live until the last socket of a project is released", () => {
    const listener = vi.fn();
    const stop = subscribeToProjectSockets(listener);
    const first = markProjectSocketLive("p");
    const second = markProjectSocketLive("p");
    first();
    first();
    expect(isProjectSocketLive("p")).toBe(true);
    second();
    expect(isProjectSocketLive("p")).toBe(false);
    expect(isProjectSocketLive("other")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
  });
});

describe("batched refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs each key once for a burst", async () => {
    const batch = createBatchedRefresh();
    const board = vi.fn();
    const lists = vi.fn();
    for (let i = 0; i < 50; i++) {
      batch.schedule("board", board);
      batch.schedule("lists", lists);
    }
    expect(board).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(board).toHaveBeenCalledOnce();
    expect(lists).toHaveBeenCalledOnce();
    batch.dispose();
  });

  it("never overlaps refreshes, and runs what arrived during one once afterwards", async () => {
    const batch = createBatchedRefresh();
    const running = deferred();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(running.promise)
      .mockResolvedValue(undefined);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) {
      batch.schedule("board", refresh);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    running.resolve();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    batch.dispose();
  });

  it("rests longer after a slow refresh, up to a limit, and not after a quiet spell", async () => {
    const batch = createBatchedRefresh();
    const slow = (ms: number) => () =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const refresh = vi.fn(slow(1_000));
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(250 + 1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Four times the last refresh: 4 s after it finished.
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    // Quiet for a minute: a lone change shows after the short delay.
    await vi.advanceTimersByTimeAsync(60_000);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);

    // A very slow refresh rests ten seconds at most.
    const verySlow = vi.fn(slow(20_000));
    batch.schedule("board", verySlow);
    await vi.advanceTimersByTimeAsync(4_000 + 20_000);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(4);
    batch.dispose();
  });

  it("does not let a refresh that never settles block later changes", async () => {
    const batch = createBatchedRefresh();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(undefined);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(250);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(30_000 + 10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    batch.dispose();
  });

  it("keeps going after a refresh fails", async () => {
    const batch = createBatchedRefresh();
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockImplementationOnce(() => {
        throw new Error("failed synchronously");
      })
      .mockResolvedValue(undefined);
    for (let run = 0; run < 3; run++) {
      batch.schedule("board", refresh);
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(refresh).toHaveBeenCalledTimes(3);
    batch.dispose();
  });

  it("holds refreshes in a hidden tab until it wakes", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const batch = createBatchedRefresh();
    const refresh = vi.fn();
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(60_000);
    batch.schedule("board", refresh);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    batch.wake();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    batch.dispose();
  });

  it("wakes without running anything when nothing waits", async () => {
    const batch = createBatchedRefresh();
    batch.wake();
    expect(vi.getTimerCount()).toBe(0);
    batch.dispose();
  });

  it("drops what waits on dispose and ignores later requests", async () => {
    const batch = createBatchedRefresh();
    const refresh = vi.fn();
    batch.schedule("board", refresh);
    batch.dispose();
    batch.schedule("board", refresh);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
