import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintThrottle } from "../../../apps/api/src/ws/hint-throttle";

describe("HintThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first value at once and the latest one when the window ends", () => {
    const send = vi.fn();
    const throttle = new HintThrottle<number>(60_000, send);
    throttle.push("a", 1);
    throttle.push("a", 2);
    throttle.push("a", 3);
    throttle.push("b", 10);
    expect(send.mock.calls).toEqual([[1], [10]]);

    vi.advanceTimersByTime(60_000);
    expect(send.mock.calls).toEqual([[1], [10], [3]]);

    // The trailing send opened a new window.
    throttle.push("a", 4);
    expect(send).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60_000);
    expect(send.mock.calls.at(-1)).toEqual([4]);

    vi.advanceTimersByTime(60_000);
    throttle.push("a", 5);
    expect(send.mock.calls.at(-1)).toEqual([5]);
  });

  it("drops pending values on clear", () => {
    const send = vi.fn();
    const throttle = new HintThrottle<number>(1000, send);
    throttle.push("a", 1);
    throttle.push("a", 2);
    throttle.clear();
    vi.advanceTimersByTime(5000);
    expect(send.mock.calls).toEqual([[1]]);
  });
});
