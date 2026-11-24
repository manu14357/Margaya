import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChunkLoadError,
  hasChunkLoadFailed,
  isChunkLoadFailure,
  reportChunkLoadFailure,
  resetChunkLoadFailure,
  retryChunk,
  subscribeToChunkLoadFailure,
} from "./chunk-load";

const fetchFailure = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: https://app.test/assets/board-abc.js",
  );

afterEach(() => {
  vi.useRealTimers();
  resetChunkLoadFailure();
});

describe("isChunkLoadFailure", () => {
  it("recognises each browser's failed-fetch message", () => {
    expect(isChunkLoadFailure(fetchFailure())).toBe(true);
    expect(
      isChunkLoadFailure(
        new TypeError("error loading dynamically imported module: /a.js"),
      ),
    ).toBe(true);
    expect(
      isChunkLoadFailure(new TypeError("Importing a module script failed.")),
    ).toBe(true);
    expect(
      isChunkLoadFailure(new Error("Unable to preload CSS for /a.css")),
    ).toBe(true);
    expect(isChunkLoadFailure(new ChunkLoadError())).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isChunkLoadFailure(new Error("boom"))).toBe(false);
    expect(isChunkLoadFailure("Failed to fetch dynamically")).toBe(false);
  });
});

describe("retryChunk", () => {
  it("tries a chunk again after a failed fetch", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockRejectedValueOnce(fetchFailure())
      .mockRejectedValueOnce(fetchFailure())
      .mockResolvedValue({ default: "module" });
    const loading = retryChunk(load);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(loading).resolves.toEqual({ default: "module" });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("gives up with a ChunkLoadError the router does not reload on", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValue(fetchFailure());
    const loading = retryChunk(load, [10, 20]);
    const result = expect(loading).rejects.toBeInstanceOf(ChunkLoadError);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(load).toHaveBeenCalledTimes(3);
    const error = (await loading.catch((caught: unknown) => caught)) as Error;
    // The router reloads the page on messages that start this way.
    expect(error.message.startsWith("Failed to fetch dynamically")).toBe(false);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("does not retry an error raised by the loaded module itself", async () => {
    const broken = new SyntaxError("Unexpected token");
    const load = vi.fn().mockRejectedValue(broken);
    await expect(retryChunk(load)).rejects.toBe(broken);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("chunk load failure signal", () => {
  it("notifies once", () => {
    const listener = vi.fn();
    const stop = subscribeToChunkLoadFailure(listener);
    reportChunkLoadFailure();
    reportChunkLoadFailure();
    expect(hasChunkLoadFailed()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
